import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators';

// El payload lo define TokenService (quien lo emite). Se importa y
// reexporta acá para no duplicar la forma del token en dos lugares.
import type { AccessTokenPayload } from '../../auth/token.service';
export type { AccessTokenPayload };

/**
 * Valida el access token. NO resuelve el club: eso es responsabilidad de
 * TenantGuard, que corre después y necesita la BD.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);

    if (!token) {
      throw new UnauthorizedException('Token de acceso requerido');
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      (req as any).auth = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    // Cookie httpOnly para el portal web (evita XSS token theft).
    const cookie = (req as any).cookies?.access_token;
    return typeof cookie === 'string' ? cookie : null;
  }
}
