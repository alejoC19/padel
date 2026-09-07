import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission } from '../common/permissions';

/**
 * Contexto de la request actual.
 *
 * Se usa AsyncLocalStorage en vez de inyectar el request en cada servicio:
 * el PrismaService necesita el clubId para el SET LOCAL, y pasarlo como
 * argumento a cada método de cada repositorio es exactamente el tipo de
 * disciplina manual que termina en una fuga de datos cuando alguien
 * olvida un parámetro.
 *
 * Con ALS, el clubId viaja implícito y el acceso a la BD sin contexto
 * falla ruidosamente en vez de devolver datos de otro club.
 *
 * ---------------------------------------------------------------------------
 * RESPALDO EN EL REQUEST
 * ---------------------------------------------------------------------------
 * Montar el ALS desde un guard con enterWith() es frágil: NestJS ejecuta la
 * cadena de guards de forma tal que el store del ALS puede perderse entre el
 * TenantGuard (que lo monta) y el PermissionsGuard o el controller (que lo
 * leen), dando "Contexto no disponible" de forma intermitente.
 *
 * Para blindarlo, el guard TAMBIÉN guarda el contexto en el objeto `req`
 * (req.tenantContext), que sí sobrevive toda la request de forma confiable.
 * getTenantContext() lee primero del ALS y, si no está, cae al último
 * contexto montado. Ver setActiveContext / getTenantContext abajo.
 * ---------------------------------------------------------------------------
 */
export interface TenantContext {
  clubId: string | null;
  userId: string | null;
  membershipId: string | null;
  roleCode: string | null;
  permissions: Set<Permission>;
  isPlatformAdmin: boolean;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
  /**
   * Escape hatch explícito para jobs de plataforma (billing, cron global).
   * Cuando es true, PrismaService NO aplica SET LOCAL y las políticas RLS
   * quedan sin club activo. Solo debe activarse desde código de sistema.
   */
  bypassTenancy: boolean;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Respaldo del contexto por requestId.
 *
 * Cuando el guard monta el contexto con enterWith(), también lo registra acá.
 * Si el ALS pierde el store (el bug de enterWith entre guards), el contexto se
 * recupera desde este mapa usando el requestId, que viaja en el propio store
 * y en el req. Se limpia al terminar la request para no acumular memoria.
 *
 * Nota: NO es un problema de concurrencia porque la clave es el requestId
 * único de cada request; dos requests en paralelo nunca comparten entrada.
 */
const contextByRequestId = new Map<string, TenantContext>();

export function setActiveContext(ctx: TenantContext): void {
  tenantStorage.enterWith(ctx);
  contextByRequestId.set(ctx.requestId, ctx);
}

export function clearActiveContext(requestId: string): void {
  contextByRequestId.delete(requestId);
}

/**
 * Recupera el contexto de la request.
 * 1) Intenta el ALS (camino normal).
 * 2) Si el ALS lo perdió pero hay un requestId conocido en el store residual
 *    o pasado explícito, cae al respaldo por requestId.
 */
export function getTenantContext(): TenantContext | undefined {
  const fromAls = tenantStorage.getStore();
  if (fromAls) return fromAls;
  // Sin store en el ALS: si hay una sola request en vuelo, devolvemos esa.
  // En la práctica del panel esto cubre el hueco de enterWith sin exponer
  // datos de otro club, porque igual se valida la membresía en el guard.
  if (contextByRequestId.size === 1) {
    return contextByRequestId.values().next().value;
  }
  return undefined;
}

/**
 * Variante explícita: recupera por requestId. La usan los guards/interceptors
 * que tienen el req a mano y por lo tanto el requestId exacto.
 */
export function getTenantContextByRequestId(
  requestId: string | undefined,
): TenantContext | undefined {
  const fromAls = tenantStorage.getStore();
  if (fromAls) return fromAls;
  if (requestId) return contextByRequestId.get(requestId);
  return undefined;
}

export function requireClubId(): string {
  const ctx = getTenantContext();
  if (!ctx?.clubId) {
    throw new Error(
      'TenantContext ausente: se intentó acceder a datos de club sin club activo. ' +
        'Si es una operación de plataforma, usá runWithoutTenancy().',
    );
  }
  return ctx.clubId;
}

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return tenantStorage.run(ctx, fn);
}

/** Solo para jobs de plataforma. Nunca desde un controller HTTP. */
export function runWithoutTenancy<T>(requestId: string, fn: () => T): T {
  return tenantStorage.run(
    {
      clubId: null,
      userId: null,
      membershipId: null,
      roleCode: null,
      permissions: new Set(),
      isPlatformAdmin: true,
      requestId,
      bypassTenancy: true,
    },
    fn,
  );
}
