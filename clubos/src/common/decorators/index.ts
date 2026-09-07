import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Permission } from '../permissions';
import { getTenantContext, type TenantContext } from '../../tenancy/tenant-context';

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
  (_: unknown, __: ExecutionContext): TenantContext => {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('TenantContext no disponible');
    return ctx;
  },
);

/** Inyecta el clubId activo. */
export const ClubId = createParamDecorator((): string => {
  const ctx = getTenantContext();
  if (!ctx?.clubId) throw new Error('Club activo no disponible');
  return ctx.clubId;
});

/** Inyecta el userId autenticado. */
export const UserId = createParamDecorator((): string => {
  const ctx = getTenantContext();
  if (!ctx?.userId) throw new Error('Usuario no autenticado');
  return ctx.userId;
});
