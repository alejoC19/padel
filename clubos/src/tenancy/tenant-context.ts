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
 * POR QUÉ EL CONTEXTO SE MONTA DESDE UN INTERCEPTOR, NO DESDE EL GUARD
 * ---------------------------------------------------------------------------
 * Versión anterior de este archivo montaba el ALS con `enterWith()` desde
 * TenantGuard. `enterWith()` no abre un scope propio: pisa el store "actual"
 * para lo que siga ejecutándose en esa misma cadena — y bajo tráfico
 * concurrente real (varias requests en vuelo, que es el caso normal de
 * cualquier pantalla que dispara varios fetches al cargar) dos llamadas a
 * `enterWith()` de requests distintas pueden pisarse entre sí. El síntoma
 * observado: "TenantContext no disponible" (500) cuando el store se perdía
 * del todo, y — más grave — el riesgo real de que una request terminara
 * corriendo con el contexto de OTRA request (otro club) si el timing caía
 * mal, porque `enterWith()` no aísla nada.
 *
 * `TenantContextInterceptor` (`common/interceptors/tenant-context.interceptor.ts`)
 * envuelve `next.handle()` — el resto del pipeline: interceptores
 * posteriores, el controller y todo lo que ese controller `await`ea — en
 * `tenantStorage.run(ctx, ...)`. A diferencia de `enterWith()`, `run()` abre
 * un scope real: el store queda aislado para esa cadena de continuaciones
 * async específica, sin pisar ni ser pisado por otra request concurrente.
 * Es la forma correcta de propagar contexto por request con ALS en Nest
 * (mismo patrón que usan librerías como nestjs-cls) y es la razón por la
 * que ya no hace falta el resguardo por requestId que tenía esta clase
 * antes: con `run()` bien alcanzado, el ALS no se pierde.
 *
 * Los guards (TenantGuard, PermissionsGuard) corren ANTES de que el
 * interceptor abra ese scope — todavía no hay nada en el ALS cuando se
 * ejecutan — así que leen el contexto de `req.tenantContext` directo, no de
 * `getTenantContext()`. Los decoradores de parámetro (`@Ctx`, `@ClubId`,
 * `@UserId`) hacen lo mismo por las dudas, aunque para cuando corre el
 * controller el ALS ya está armado.
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

/** Recupera el contexto de la request desde el AsyncLocalStorage. */
export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
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
