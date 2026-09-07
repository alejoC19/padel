import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getTenantContext } from '../../tenancy/tenant-context';
import type { Permission } from '../permissions';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators';

/**
 * Verifica permisos. Corre después de TenantGuard, que ya resolvió el set
 * efectivo (rol + extras − revocados).
 *
 * Semántica: se exigen TODOS los permisos declarados, no cualquiera. Un
 * "OR" implícito genera agujeros silenciosos difíciles de auditar.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length) return true;

    const ctx = getTenantContext();
    if (!ctx) throw new ForbiddenException('Contexto no disponible');

    if (ctx.isPlatformAdmin && ctx.bypassTenancy) return true;

    const missing = required.filter((p) => !ctx.permissions.has(p));

    if (missing.length) {
      throw new ForbiddenException({
        message: 'Permisos insuficientes para esta operación',
        required: missing,
      });
    }

    return true;
  }
}
