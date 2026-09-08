import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';
import { runWithoutTenancy } from '../tenancy/tenant-context';
import { ROLE_PRESETS } from '../common/permissions';
import { EmailChannel } from '../notifications/services/channels/email.channel';
import { generateSecureToken, hashToken } from '../common/utils/secure-token.util';
import type {
  AcceptInviteDto,
  AuthResponse,
  ChangePasswordDto,
  ClubSummary,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
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
    private readonly config: ConfigService,
    private readonly email: EmailChannel,
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

  /**
   * "Olvidé mi contraseña". Siempre responde igual exista o no la cuenta
   * (evita enumeración de emails) — el controller no distingue los casos,
   * este método directamente no lanza si el usuario no existe.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, firstName: true, isActive: true, deletedAt: true },
    });

    if (!user || !user.isActive || user.deletedAt) return;

    const { raw, hash } = generateSecureToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        purpose: 'RESET',
        expiresAt: new Date(Date.now() + 60 * 60_000), // 1 hora
      },
    });

    const link = `${this.webUrl()}/restablecer-contrasena?token=${raw}`;
    await this.email.send({
      to: dto.email,
      subject: 'Restablecé tu contraseña — ClubOS',
      body:
        `Hola ${user.firstName},\n\n` +
        `Pediste restablecer tu contraseña de ClubOS. Entrá acá para elegir una nueva ` +
        `(el link vence en 1 hora):\n\n${link}\n\n` +
        `Si no fuiste vos, ignorá este mensaje — tu contraseña actual sigue funcionando.`,
    });
  }

  /** Consume el token de "olvidé mi contraseña" y fija la nueva. */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const userId = await this.consumeToken(dto.token, 'RESET');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, 12),
        passwordChangedAt: new Date(),
      },
    });

    // Mismo motivo que en changePassword: una sesión robada no debe
    // sobrevivir a un reset.
    await this.tokens.revokeAllForUser(userId);
  }

  /**
   * Acepta una invitación de staff: fija la contraseña de una cuenta creada
   * por TeamService.invite() sin una (ver team.service.ts), activa la
   * membership pendiente y devuelve sesión iniciada — evita un paso extra
   * de login justo después de aceptar.
   */
  async acceptInvite(
    dto: AcceptInviteDto,
    device: DeviceInfo,
  ): Promise<AuthResponse> {
    const userId = await this.consumeToken(dto.token, 'INVITE');

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(dto.password, 12),
        passwordChangedAt: new Date(),
        emailVerified: true, // llegó al link del mail: probó tener acceso a la cuenta.
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

    // Activa TODAS las membership INVITED del usuario (en la práctica, la
    // única que TeamService.invite() creó) — el token no lleva clubId
    // porque pertenece a la cuenta, no a un club puntual.
    await runWithoutTenancy(randomUUID(), async () =>
      this.prisma.db.membership.updateMany({
        where: { userId, status: 'INVITED' },
        data: { status: 'ACTIVE', acceptedAt: new Date() },
      }),
    );

    const clubs = await this.listClubs(userId);
    const activeClubId = clubs.length === 1 ? clubs[0].id : null;
    const issued = await this.tokens.issue(user, activeClubId, device);

    if (activeClubId) await this.logAuthEvent(activeClubId, userId, 'LOGIN', device);

    return this.buildResponse(user, issued, activeClubId, clubs);
  }

  /** Permisos efectivos del usuario en un club. */
  async getPermissions(userId: string, clubId: string): Promise<string[]> {
    // Se llama desde login/refresh/switch-club, ANTES de que exista un
    // TenantContext de request (todavía se está decidiendo a qué club se
    // entra). `membership` tiene RLS: sin bypass, con el rol restringido de
    // la app esto siempre devuelve 0 filas. Ver PrismaService "BYPASS DE
    // PLATAFORMA".
    // El callback tiene que ser `async`: ver la nota en token.service.ts
    // sobre por qué una arrow que solo reenvía la promesa de Prisma pierde
    // el contexto de bypass.
    const m = await runWithoutTenancy(randomUUID(), async () =>
      this.prisma.db.membership.findFirst({
        where: { clubId, userId, status: 'ACTIVE', deletedAt: null },
        select: {
          extraPermissions: true,
          revokedPermissions: true,
          role: { select: { permissions: true } },
        },
      }),
    );

    if (!m) return [];

    const set = new Set<string>([
      ...m.role.permissions,
      ...m.extraPermissions,
    ]);
    for (const r of m.revokedPermissions) set.delete(r);
    return [...set];
  }

  // --- internos ---

  private webUrl(): string {
    return this.config.get<string>('WEB_PUBLIC_URL') ?? 'http://localhost:3001';
  }

  /**
   * Valida un PasswordResetToken (reset o invite), lo marca usado y
   * devuelve el userId. Un solo camino para ambos flujos: misma tabla,
   * mismo criterio de validez (no usado, no vencido), solo cambia qué hace
   * el caller después de fijar la contraseña.
   */
  private async consumeToken(
    raw: string,
    purpose: 'RESET' | 'INVITE',
  ): Promise<string> {
    const hash = hashToken(raw);
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hash },
      select: { id: true, userId: true, purpose: true, usedAt: true, expiresAt: true },
    });

    if (
      !token ||
      token.purpose !== purpose ||
      token.usedAt ||
      token.expiresAt < new Date()
    ) {
      throw new BadRequestException('El link venció o ya fue usado. Pedí uno nuevo.');
    }

    await this.prisma.passwordResetToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });

    return token.userId;
  }

  private async listClubs(userId: string): Promise<ClubSummary[]> {
    // Cross-tenant por naturaleza (los clubes de un usuario, sin saber
    // todavía a cuál va a entrar) — mismo motivo que getPermissions arriba.
    const memberships = await runWithoutTenancy(randomUUID(), async () =>
      this.prisma.db.membership.findMany({
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
      }),
    );

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
