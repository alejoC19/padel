import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Permission } from '../permissions';
import { getTenantContext, type TenantContext } from '../../tenancy/tenant-context';

/**
 * Contexto de esta request puntual, leído de `req.tenantContext`.
 *
 * TenantGuard lo deja ahí (ver tenant.guard.ts `mount()`) además de montarlo
 * en el AsyncLocalStorage — es la fuente confiable, atada al objeto de ESTA
 * request, sin la fragilidad documentada en tenant-context.ts sobre
 * `enterWith()` perdiendo el store entre guards bajo tráfico concurrente
 * (dos o más requests en vuelo a la vez rompen incluso el resguardo por
 * requestId, que solo funciona si hay una sola). Los decoradores de acá
 * abajo tenían acceso al `ExecutionContext` — y por lo tanto a `req`— desde
 * el principio, pero llamaban a la variante global `getTenantContext()`
 * en vez de leer el campo confiable: bajo carga concurrente real (el panel
 * dispara varios fetches en paralelo al cargar una pantalla), el ALS
 * fallaba justo para la request que además tenía más de una request
 * hermana en vuelo, y el catch-all devolvía 500 "TenantContext no
 * disponible" en vez de servir la respuesta.
 */
function contextFromRequest(execCtx: ExecutionContext): TenantContext | undefined {
  const req = execCtx.switchToHttp().getRequest<{ tenantContext?: TenantContext }>();
  return req.tenantContext ?? getTenantContext();
}

export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSIONS_KEY = 'requiredPermissions';
export const PLATFORM_ONLY_KEY = 'platformOnly';
export const SKIP_TENANT_KEY = 'skipTenant';

/** Endpoint sin autenticación (login, registro, webhooks firmados). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Requiere TODOS los permisos listados.
 * Ej: @RequirePermissions(PERMISSIONS.CASH_CLOSE)
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Solo Super Admin de ClubOS. */
export const PlatformOnly = () => SetMetadata(PLATFORM_ONLY_KEY, true);

/**
 * Endpoint autenticado pero sin club activo.
 * Ej: listar los clubes a los que pertenece el usuario tras el login.
 */
export const SkipTenant = () => SetMetadata(SKIP_TENANT_KEY, true);

/** Inyecta el contexto completo. */
export const Ctx = createParamDecorator(
  (_: unknown, execCtx: ExecutionContext): TenantContext => {
    const ctx = contextFromRequest(execCtx);
    if (!ctx) throw new Error('TenantContext no disponible');
    return ctx;
  },
);

/** Inyecta el clubId activo. */
export const ClubId = createParamDecorator((_: unknown, execCtx: ExecutionContext): string => {
  const ctx = contextFromRequest(execCtx);
  if (!ctx?.clubId) throw new Error('Club activo no disponible');
  return ctx.clubId;
});

/** Inyecta el userId autenticado. */
export const UserId = createParamDecorator((_: unknown, execCtx: ExecutionContext): string => {
  const ctx = contextFromRequest(execCtx);
  if (!ctx?.userId) throw new Error('Usuario no autenticado');
  return ctx.userId;
});
