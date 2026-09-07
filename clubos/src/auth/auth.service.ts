import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';
import { runWithoutTenancy } from '../tenancy/tenant-context';
import { ROLE_PRESETS } from '../common/permissions';
import type {
  AuthResponse,
  ChangePasswordDto,
  ClubSummary,
  LoginDto,
  RegisterDto,
} from './dto/auth.dto';

interface DeviceInfo {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Servicio de autenticación.
 *
 * ---------------------------------------------------------------------------
 * NOTA IMPORTANTE SOBRE TENANCY
 * ---------------------------------------------------------------------------
 * Todo este servicio corre ANTES de que exista contexto de club: en el login
 * todavía no sabemos a qué club entra el usuario. Por eso usa
 * `this.prisma.*` directamente (el cliente base, sin la extensión) y no
 * `this.prisma.db.*`.
 *
 * Las tablas que toca — User, Session, Club, Membership, Role — están en
 * PLATFORM_MODELS o se consultan con `runWithoutTenancy`, así que no
 * disparan el chequeo de club activo. Cualquier lectura de datos de negocio
 * desde acá sería un bug.
 * ---------------------------------------------------------------------------
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Hash dummy para comparar cuando el usuario no existe. Iguala el tiempo
   * de respuesta entre "email inexistente" y "contraseña incorrecta"; sin
   * esto, la diferencia de latencia permite enumerar cuentas registradas.
   */
  private readonly dummyHash = bcrypt.hashSync('dummy-timing-equalizer', 12);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async login(dto: LoginDto, device: DeviceInfo): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        isPlatformAdmin: true,
        isActive: true,
        deletedAt: true,
      },
    });

    const hash = user?.passwordHash ?? this.dummyHash;
    const valid = await bcrypt.compare(dto.password, hash);

    // Mismo mensaje en todos los fallos: no revelar si el email existe.
    if (!user || !valid || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException('Email o contraseña incorrectos');
    }

    const clubs = await this.listClubs(user.id);

    let activeClubId: string | null = null;
    if (dto.clubId) {
      if (!clubs.some((c) => c.id === dto.clubId)) {
        throw new UnauthorizedException('No tenés acceso a este club');
      }
      activeClubId = dto.clubId;
    } else if (clubs.length === 1) {
      // Un solo club: seleccionarlo evita un paso extra innecesario.
      activeClubId = clubs[0].id;
    }

    const issued = await this.tokens.issue(user, activeClubId, device);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    if (activeClubId) {
      await this.logAuthEvent(activeClubId, user.id, 'LOGIN', device);
    }

    return this.buildResponse(user, issued, activeClubId, clubs);
  }

  /**
   * Registro público: crea la cuenta SIN club. El usuario queda disponible
   * para ser invitado a un club o para crear el suyo (flujo de onboarding
   * separado, que involucra elegir plan y medio de pago).
   */
  async register(dto: RegisterDto, device: DeviceInfo): Promise<AuthResponse> {
    const exists = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.email },
          ...(dto.phone ? [{ phone: dto.phone }] : []),
        ],
      },
      select: { id: true },
    });

    if (exists) {
      throw new ConflictException('Ya existe una cuenta con esos datos');
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, 12),
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        isPlatformAdmin: true,
      },
    });

    const issued = await this.tokens.issue(user, null, device);
    return this.buildResponse(user, issued, null, []);
  }

  async refresh(
    refreshToken: string,
    device: DeviceInfo,
  ): Promise<AuthResponse> {
    const { tokens, userId, clubId } = await this.tokens.rotate(
      refreshToken,
      device,
    );

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        isPlatformAdmin: true,
      },
    });

    const clubs = await this.listClubs(userId);
    return this.buildResponse(user, tokens, clubId, clubs);
  }

  /**
   * Cambio de club activo. Emite tokens nuevos en vez de dejar que el
   * front mande `x-club-id` indefinidamente: así el club activo queda
   * firmado en el token y auditado en la sesión.
   */
  async switchClub(
    refreshToken: string,
    clubId: string,
    device: DeviceInfo,
  ): Promise<AuthResponse> {
    const { tokens, userId } = await this.tokens.rotate(
      refreshToken,
      device,
      clubId,
    );

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        isPlatformAdmin: true,
      },
    });

    const clubs = await this.listClubs(userId);
    await this.logAuthEvent(clubId, userId, 'LOGIN', device);

    return this.buildResponse(user, tokens, clubId, clubs);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revoke(refreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!user.passwordHash) {
      throw new BadRequestException(
        'Tu cuenta usa inicio de sesión con Google o Apple.',
      );
    }

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('La contraseña actual es incorrecta');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'La contraseña nueva debe ser distinta de la actual',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, 12),
        passwordChangedAt: new Date(),
      },
    });

    // Cambiar la contraseña cierra todas las sesiones: si el motivo fue
    // una sospecha de robo, dejar sesiones vivas anula la medida.
    await this.tokens.revokeAllForUser(userId);
  }

  /** Permisos efectivos del usuario en un club. */
  async getPermissions(userId: string, clubId: string): Promise<string[]> {
    const m = await this.prisma.membership.findFirst({
      where: { clubId, userId, status: 'ACTIVE', deletedAt: null },
      select: {
        extraPermissions: true,
        revokedPermissions: true,
        role: { select: { permissions: true } },
      },
    });

    if (!m) return [];

    const set = new Set<string>([
      ...m.role.permissions,
      ...m.extraPermissions,
    ]);
    for (const r of m.revokedPermissions) set.delete(r);
    return [...set];
  }

  // --- internos ---

  private async listClubs(userId: string): Promise<ClubSummary[]> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        deletedAt: null,
        club: { deletedAt: null, status: { notIn: ['CANCELLED'] } },
      },
      select: {
        role: { select: { code: true } },
        club: {
          select: {
            id: true,
            slug: true,
            name: true,
            logoUrl: true,
            status: true,
          },
        },
      },
      orderBy: { club: { name: 'asc' } },
    });

    return memberships.map(
      (m: {
        role: { code: string };
        club: {
          id: string;
          slug: string;
          name: string;
          logoUrl: string | null;
          status: string;
        };
      }) => ({
        id: m.club.id,
        slug: m.club.slug,
        name: m.club.name,
        logoUrl: m.club.logoUrl,
        roleCode: m.role.code,
        status: m.club.status,
      }),
    );
  }

  private async buildResponse(
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      avatarUrl: string | null;
      isPlatformAdmin: boolean;
    },
    tokens: { accessToken: string; refreshToken: string; expiresIn: number },
    activeClubId: string | null,
    clubs: ClubSummary[],
  ): Promise<AuthResponse> {
    const permissions = activeClubId
      ? await this.getPermissions(user.id, activeClubId)
      : [];

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        isPlatformAdmin: user.isPlatformAdmin,
      },
      activeClub: clubs.find((c) => c.id === activeClubId) ?? null,
      clubs,
      permissions,
    };
  }

  /**
   * Audita login/logout. Requiere clubId porque audit_logs es tenant-scoped
   * y está protegida por RLS: se abre contexto explícito para el INSERT.
   */
  private async logAuthEvent(
    clubId: string,
    userId: string,
    action: 'LOGIN' | 'LOGOUT' | 'LOGIN_FAILED',
    device: DeviceInfo,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_club_id', ${clubId}, true)`;
        await tx.auditLog.create({
          data: {
            clubId,
            userId,
            action,
            entityType: 'Session',
            ipAddress: device.ipAddress,
            userAgent: device.userAgent?.slice(0, 500),
          },
        });
      });
    } catch (e) {
      // La auditoría no debe romper el login.
      this.logger.error(`No se pudo auditar ${action}: ${String(e)}`);
    }
  }
}
