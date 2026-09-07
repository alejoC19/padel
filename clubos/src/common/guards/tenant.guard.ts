import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  setActiveContext,
  clearActiveContext,
  runWithoutTenancy,
  type TenantContext,
} from '../../tenancy/tenant-context';
import type { Permission } from '../permissions';
import {
  IS_PUBLIC_KEY,
  PLATFORM_ONLY_KEY,
  SKIP_TENANT_KEY,
} from '../decorators';
import type { AccessTokenPayload } from './jwt-auth.guard';

/**
 * Resuelve el club activo y monta el contexto de la request.
 *
 * El contexto se monta con setActiveContext(), que:
 *   1) abre el AsyncLocalStorage con enterWith() (camino normal), y
 *   2) registra el contexto por requestId como respaldo.
 *
 * Ese respaldo cubre el hueco conocido de enterWith() entre guards: si el ALS
 * pierde el store antes de que el PermissionsGuard o el controller lo lean, el
 * contexto se recupera igual. El respaldo se limpia cuando la response termina
 * (evento 'finish'), para no acumular memoria.
 *
 * El contexto también queda en req.tenantContext, por si algún interceptor o
 * filtro lo necesita con el req a mano.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const auth: AccessTokenPayload | undefined = req.auth;

    if (!auth) throw new UnauthorizedException();

    const platformOnly = this.reflector.getAllAndOverride<boolean>(
      PLATFORM_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );
    const skipTenant = this.reflector.getAllAndOverride<boolean>(
      SKIP_TENANT_KEY,
      [context.getHandler(), context.getClass()],
    );

    const requestId =
      (req.headers['x-request-id'] as string) ?? randomUUID();
    const base = {
      userId: auth.sub,
      isPlatformAdmin: auth.isPlatformAdmin,
      requestId,
      ipAddress: this.clientIp(req),
      userAgent: req.headers['user-agent'],
    };

    if (platformOnly) {
      if (!auth.isPlatformAdmin) {
        throw new ForbiddenException('Requiere permisos de plataforma');
      }
      this.mount(req, res, {
        ...base,
        clubId: null,
        membershipId: null,
        roleCode: 'PLATFORM_ADMIN',
        permissions: new Set<Permission>(),
        bypassTenancy: true,
      });
      return true;
    }

    if (skipTenant) {
      this.mount(req, res, {
        ...base,
        clubId: null,
        membershipId: null,
        roleCode: null,
        permissions: new Set<Permission>(),
        bypassTenancy: true,
      });
      return true;
    }

    // El club puede venir del token o de un header (cambio de club sin
    // re-login en el panel). Se valida la pertenencia en ambos casos.
    const clubId =
      (req.headers['x-club-id'] as string | undefined) ?? auth.clubId;

    if (!clubId) {
      throw new ForbiddenException(
        'No hay club activo. Seleccioná un club para continuar.',
      );
    }

    // Se corre ANTES de montar el TenantContext de esta request (es lo que
    // lo determina), así que no hay clubId activo todavía. `membership`
    // tiene RLS: sin bypass, con el rol restringido de la app esto siempre
    // devuelve null y ninguna request autenticada podría pasar nunca este
    // guard. Ver PrismaService "BYPASS DE PLATAFORMA".
    // El callback tiene que ser `async` — ver la nota en token.service.ts.
    const membership = await runWithoutTenancy(randomUUID(), async () =>
      this.prisma.db.membership.findFirst({
        where: {
          clubId,
          userId: auth.sub,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: {
          id: true,
          extraPermissions: true,
          revokedPermissions: true,
          role: { select: { code: true, permissions: true } },
          club: { select: { id: true, status: true, deletedAt: true } },
        },
      }),
    );

    if (!membership) {
      // Mismo mensaje que "club inexistente": no revelar qué clubes existen.
      throw new ForbiddenException('No tenés acceso a este club');
    }

    if (membership.club.deletedAt) {
      throw new ForbiddenException('No tenés acceso a este club');
    }

    if (['SUSPENDED', 'CANCELLED'].includes(membership.club.status)) {
      throw new ForbiddenException(
        'El club está suspendido. Contactá a soporte.',
      );
    }

    const permissions = new Set<Permission>([
      ...(membership.role.permissions as Permission[]),
      ...(membership.extraPermissions as Permission[]),
    ]);
    for (const revoked of membership.revokedPermissions) {
      permissions.delete(revoked as Permission);
    }

    this.mount(req, res, {
      ...base,
      clubId,
      membershipId: membership.id,
      roleCode: membership.role.code,
      permissions,
      bypassTenancy: false,
    });

    return true;
  }

  /**
   * Monta el contexto en el ALS + respaldo, lo deja en req, y programa la
   * limpieza del respaldo cuando la response termina.
   */
  private mount(req: Request, res: Response, ctx: TenantContext): void {
    setActiveContext(ctx);
    req.tenantContext = ctx;
    // Limpiar el respaldo al cerrar la response (una sola vez).
    res.once('finish', () => clearActiveContext(ctx.requestId));
    res.once('close', () => clearActiveContext(ctx.requestId));
  }

  private clientIp(req: Request): string | undefined {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string') return fwd.split(',')[0].trim();
    return req.socket?.remoteAddress ?? undefined;
  }
}
