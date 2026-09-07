import type { AccessTokenPayload } from '../auth/token.service';
import type { TenantContext } from '../tenancy/tenant-context';

/**
 * Propiedades que los guards cuelgan de `Request` en cada request:
 * `JwtAuthGuard` pone `auth`, `TenantGuard` pone `tenantContext` (corre
 * después, ya con el club resuelto). Sin esto, leerlas obligaba a un
 * `as any` en cada guard/controller que las usa.
 */
declare module 'express' {
  interface Request {
    auth?: AccessTokenPayload;
    tenantContext?: TenantContext;
  }
}
