import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  clubId?: string;
  isPlatformAdmin: boolean;
  sid: string;
  iat: number;
  exp: number;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number;
}

interface DeviceInfo {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Emisión y rotación de tokens.
 *
 * ---------------------------------------------------------------------------
 * MODELO
 * ---------------------------------------------------------------------------
 * Access token: JWT corto (15m), stateless, lleva el clubId activo.
 * Refresh token: opaco (256 bits aleatorios), largo (30d), guardado HASHEADO.
 *
 * Por qué el refresh es opaco y no JWT: un JWT de refresh no se puede
 * revocar sin una lista de bloqueo, que es una tabla de todos modos. Con un
 * token opaco la revocación es un UPDATE y el estado ya vive en `sessions`.
 *
 * Por qué se guarda hasheado: si se filtra la tabla `sessions`, los tokens
 * en claro permitirían suplantar a cualquier usuario. Se usa SHA-256 y no
 * bcrypt a propósito — el token ya tiene 256 bits de entropía, no hay nada
 * que un ataque de diccionario pueda hacer, y bcrypt en cada refresh sería
 * un costo inútil de ~100ms.
 *
 * ---------------------------------------------------------------------------
 * ROTACIÓN CON DETECCIÓN DE REUSO
 * ---------------------------------------------------------------------------
 * Cada refresh invalida el token usado y emite uno nuevo, encadenados por
 * `replacedById`. Si llega un token YA rotado, hay dos escenarios: o lo
 * robaron y el atacante lo está usando, o lo robaron y el legítimo lo está
 * usando después del atacante. No se puede distinguir cuál es cuál, así que
 * se revoca TODA la cadena de sesiones del usuario y se fuerza re-login.
 * Es la única respuesta segura.
 * ---------------------------------------------------------------------------
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  private readonly accessTtl = process.env.ACCESS_TOKEN_TTL ?? '15m';
  private readonly refreshTtlDays = Number(
    process.env.REFRESH_TOKEN_TTL_DAYS ?? 30,
  );

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async issue(
    user: { id: string; email: string; isPlatformAdmin: boolean },
    clubId: string | null,
    device: DeviceInfo,
  ): Promise<IssuedTokens> {
    const sessionId = randomUUID();
    const refreshToken = this.generateOpaqueToken();

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        activeClubId: clubId,
        refreshTokenHash: this.hash(refreshToken),
        userAgent: device.userAgent?.slice(0, 500),
        ipAddress: device.ipAddress,
        expiresAt: this.refreshExpiry(),
      },
    });

    const accessToken = await this.signAccess(user, clubId, sessionId);

    return {
      accessToken,
      refreshToken,
      sessionId,
      expiresIn: this.accessTtlSeconds(),
    };
  }

  /**
   * Rota el refresh token. Devuelve el par nuevo y la sesión resultante.
   */
  async rotate(
    refreshToken: string,
    device: DeviceInfo,
    overrideClubId?: string | null,
  ): Promise<{
    tokens: IssuedTokens;
    userId: string;
    clubId: string | null;
  }> {
    const hash = this.hash(refreshToken);

    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hash },
      select: {
        id: true,
        userId: true,
        activeClubId: true,
        expiresAt: true,
        revokedAt: true,
        replacedById: true,
        user: {
          select: {
            id: true,
            email: true,
            isPlatformAdmin: true,
            isActive: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!session) {
      throw new UnauthorizedException('Sesión inválida');
    }

    // --- Detección de reuso ---
    if (session.revokedAt || session.replacedById) {
      this.logger.warn(
        `Reuso de refresh token detectado. user=${session.userId} session=${session.id}`,
      );
      await this.revokeAllForUser(session.userId);
      throw new UnauthorizedException(
        'Sesión comprometida. Volvé a iniciar sesión.',
      );
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Sesión expirada');
    }

    if (!session.user.isActive || session.user.deletedAt) {
      throw new UnauthorizedException('Cuenta deshabilitada');
    }

    const clubId =
      overrideClubId !== undefined ? overrideClubId : session.activeClubId;

    // Si se cambia de club, revalidar pertenencia. Sin esto, un usuario
    // expulsado de un club mantendría acceso hasta que expire el refresh.
    if (clubId) {
      const ok = await this.prisma.membership.findFirst({
        where: {
          clubId,
          userId: session.userId,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!ok) {
        throw new UnauthorizedException('No tenés acceso a este club');
      }
    }

    const newSessionId = randomUUID();
    const newRefresh = this.generateOpaqueToken();

    // Rotación atómica: marcar la vieja y crear la nueva en una transacción.
    // Si esto se partiera, quedaría una sesión huérfana o un token
    // revocado sin reemplazo (usuario deslogueado sin motivo).
    await this.prisma.$transaction([
      this.prisma.session.create({
        data: {
          id: newSessionId,
          userId: session.userId,
          activeClubId: clubId,
          refreshTokenHash: this.hash(newRefresh),
          userAgent: device.userAgent?.slice(0, 500),
          ipAddress: device.ipAddress,
          expiresAt: this.refreshExpiry(),
        },
      }),
      this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), replacedById: newSessionId },
      }),
    ]);

    const accessToken = await this.signAccess(
      session.user,
      clubId,
      newSessionId,
    );

    return {
      tokens: {
        accessToken,
        refreshToken: newRefresh,
        sessionId: newSessionId,
        expiresIn: this.accessTtlSeconds(),
      },
      userId: session.userId,
      clubId,
    };
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: this.hash(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Limpieza de sesiones vencidas. Lo llama un cron diario. */
  async purgeExpired(): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  }

  // --- internos ---

  private async signAccess(
    user: { id: string; email: string; isPlatformAdmin: boolean },
    clubId: string | null,
    sessionId: string,
  ): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        ...(clubId ? { clubId } : {}),
        isPlatformAdmin: user.isPlatformAdmin,
        sid: sessionId,
      },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: this.accessTtlSeconds(),
      },
    );
  }

  private generateOpaqueToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.refreshTtlDays * 86_400_000);
  }

  private accessTtlSeconds(): number {
    const raw = String(this.accessTtl).trim();
    // Formato con sufijo: "15m", "2h", "30s", "1d".
    const m = /^(\d+)([smhd])$/.exec(raw);
    if (m) {
      const n = Number(m[1]);
      const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]] ?? 60;
      return n * mult;
    }
    // Número crudo = segundos (ej. "900").
    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      if (n > 0) return n;
    }
    // Cualquier otra cosa: 15 min por defecto.
    return 900;
  }
}
