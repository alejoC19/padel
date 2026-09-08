import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailChannel } from '../../notifications/services/channels/email.channel';
import { generateSecureToken } from '../../common/utils/secure-token.util';
import type { TenantContext } from '../../tenancy/tenant-context';
import type { InviteStaffDto, UpdateMembershipDto } from '../dto/team.dto';

/**
 * Alta y administración de staff de un club (recepción, profesores,
 * administradores).
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTO NO EXISTÍA
 * ---------------------------------------------------------------------------
 * El schema ya traía `MembershipStatus.INVITED` y `Membership.invitedAt` —
 * pensado para este flujo — pero ningún código lo usaba: la única forma de
 * entrar a un club era ser su dueño (onboarding). Un club real tiene
 * recepcionistas y profesores desde el día uno; sin esto, el dueño es el
 * único usuario posible del sistema.
 *
 * ---------------------------------------------------------------------------
 * DOS CAMINOS SEGÚN SI EL EMAIL YA TIENE CUENTA
 * ---------------------------------------------------------------------------
 * - Ya existe un User con ese email (por ej. es dueño de otro club, o
 *   staff de otro club): se lo agrega directo como Membership ACTIVE, sin
 *   tocar su contraseña — ya puede loguearse y elegir club como siempre.
 * - No existe: se crea el User SIN contraseña (`passwordHash: null`) y la
 *   Membership queda INVITED hasta que acepte el link de invitación
 *   (mismo mecanismo de token que "olvidé mi contraseña" — ver
 *   AuthService.acceptInvite/consumeToken).
 * ---------------------------------------------------------------------------
 * PRIVILEGIOS: NUNCA POR ESCALADA
 * ---------------------------------------------------------------------------
 * El preset ADMIN tiene `user.invite` pero no `role.manage`: sin el chequeo
 * explícito de acá, un ADMIN podría invitar a alguien (o a sí mismo con otra
 * cuenta) como OWNER. Por eso tocar el rol OWNER — asignarlo o quitarlo —
 * exige que quien ejecuta la acción sea OWNER, aparte del permiso normal.
 * Mismo motivo para no permitir que el club se quede sin ningún OWNER activo.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailChannel,
  ) {}

  async list(clubId: string) {
    const memberships = await this.prisma.db.membership.findMany({
      where: { clubId, deletedAt: null },
      select: {
        id: true,
        status: true,
        invitedAt: true,
        acceptedAt: true,
        createdAt: true,
        role: { select: { id: true, code: true, name: true } },
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            isActive: true,
            lastLoginAt: true,
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
    return memberships;
  }

  /** Roles asignables desde este endpoint — CLIENT es para el portal, no staff. */
  async listRoles(clubId: string) {
    return this.prisma.db.role.findMany({
      where: { clubId, deletedAt: null, code: { not: 'CLIENT' } },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async invite(ctx: TenantContext, dto: InviteStaffDto) {
    const clubId = ctx.clubId!;

    const role = await this.prisma.db.role.findFirst({
      where: { id: dto.roleId, clubId, deletedAt: null },
      select: { id: true, code: true },
    });
    if (!role) throw new BadRequestException('Rol inválido para este club');
    this.assertCanAssign(ctx, role.code);

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, firstName: true, lastName: true, passwordHash: true },
    });

    if (existing) {
      const membership = await this.prisma.db.membership.findUnique({
        where: { clubId_userId: { clubId, userId: existing.id } },
      });

      if (membership && membership.status !== 'REVOKED' && !membership.deletedAt) {
        throw new ConflictException('Esa persona ya es parte del club');
      }

      if (membership) {
        await this.prisma.db.membership.update({
          where: { id: membership.id },
          data: {
            roleId: role.id,
            status: 'ACTIVE',
            deletedAt: null,
            invitedAt: new Date(),
            acceptedAt: new Date(),
          },
        });
      } else {
        await this.prisma.db.membership.create({
          data: {
            clubId,
            userId: existing.id,
            roleId: role.id,
            status: 'ACTIVE',
            invitedAt: new Date(),
            acceptedAt: new Date(),
          },
        });
      }

      await this.audit(clubId, ctx.userId, 'CREATE', existing.id);

      await this.email.send({
        to: dto.email,
        subject: 'Te agregaron a un club en ClubOS',
        body:
          `Hola ${existing.firstName},\n\n` +
          `Te sumaron como parte del staff de un club en ClubOS. Entrá con tu cuenta ` +
          `existente (mismo email y contraseña) y vas a verlo en tu selector de clubes.`,
      });

      return { status: 'ADDED' as const };
    }

    // No tiene cuenta: se crea sin contraseña y queda INVITED hasta que la fije.
    const newUser = await this.prisma.user.create({
      data: {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        passwordHash: null,
        emailVerified: false,
      },
      select: { id: true },
    });

    await this.prisma.db.membership.create({
      data: {
        clubId,
        userId: newUser.id,
        roleId: role.id,
        status: 'INVITED',
        invitedAt: new Date(),
      },
    });

    await this.audit(clubId, ctx.userId, 'CREATE', newUser.id);

    const { raw, hash } = generateSecureToken();
    // PasswordResetToken es de plataforma (sin clubId) — se crea con el
    // cliente base, no con `.db` (ver PLATFORM_MODELS en prisma.service.ts).
    await this.prisma.passwordResetToken.create({
      data: {
        userId: newUser.id,
        tokenHash: hash,
        purpose: 'INVITE',
        expiresAt: new Date(Date.now() + 7 * 86_400_000), // 7 días
      },
    });

    const link = `${this.webUrl()}/aceptar-invitacion?token=${raw}`;
    await this.email.send({
      to: dto.email,
      subject: 'Te invitaron a ClubOS',
      body:
        `Hola ${dto.firstName},\n\n` +
        `Te invitaron a sumarte al staff de un club en ClubOS. Entrá acá para crear tu ` +
        `contraseña y empezar a usarlo (el link vence en 7 días):\n\n${link}`,
    });

    return { status: 'INVITED' as const };
  }

  async update(ctx: TenantContext, membershipId: string, dto: UpdateMembershipDto) {
    const clubId = ctx.clubId!;
    const membership = await this.findActiveOrInvited(clubId, membershipId);

    const targetRole = dto.roleId
      ? await this.prisma.db.role.findFirst({
          where: { id: dto.roleId, clubId, deletedAt: null },
          select: { id: true, code: true },
        })
      : membership.role;
    if (dto.roleId && !targetRole) {
      throw new BadRequestException('Rol inválido para este club');
    }

    // Tocar un OWNER (el actual o el nuevo rol propuesto) exige ser OWNER.
    if (membership.role.code === 'OWNER' || targetRole?.code === 'OWNER') {
      this.assertCanAssign(ctx, 'OWNER');
    }

    if (
      (dto.status === 'SUSPENDED' || (dto.roleId && targetRole?.code !== 'OWNER')) &&
      membership.role.code === 'OWNER'
    ) {
      await this.assertNotLastOwner(clubId, membershipId);
    }

    const updated = await this.prisma.db.membership.update({
      where: { id: membershipId },
      data: {
        ...(dto.roleId ? { roleId: dto.roleId } : {}),
        ...(dto.status ? { status: dto.status } : {}),
      },
    });

    await this.audit(clubId, ctx.userId, 'PERMISSION_CHANGE', membership.userId, {
      roleId: dto.roleId,
      status: dto.status,
    });

    return updated;
  }

  async remove(ctx: TenantContext, membershipId: string) {
    const clubId = ctx.clubId!;
    const membership = await this.findActiveOrInvited(clubId, membershipId);

    if (membership.userId === ctx.userId) {
      throw new BadRequestException('No podés quitarte a vos mismo del club');
    }
    if (membership.role.code === 'OWNER') {
      this.assertCanAssign(ctx, 'OWNER');
      await this.assertNotLastOwner(clubId, membershipId);
    }

    await this.prisma.db.membership.update({
      where: { id: membershipId },
      data: { status: 'REVOKED', deletedAt: new Date() },
    });

    await this.audit(clubId, ctx.userId, 'DELETE', membership.userId);
  }

  // --- internos ---

  private webUrl(): string {
    return this.config.get<string>('WEB_PUBLIC_URL') ?? 'http://localhost:3001';
  }

  /** Solo un OWNER puede asignar o modificar el rol OWNER — nunca por permiso normal. */
  private assertCanAssign(ctx: TenantContext, roleCode: string): void {
    if (roleCode === 'OWNER' && ctx.roleCode !== 'OWNER' && !ctx.isPlatformAdmin) {
      throw new ForbiddenException('Solo un Dueño puede asignar el rol de Dueño');
    }
  }

  private async findActiveOrInvited(clubId: string, membershipId: string) {
    const membership = await this.prisma.db.membership.findFirst({
      where: { id: membershipId, clubId, deletedAt: null },
      select: {
        id: true,
        userId: true,
        role: { select: { id: true, code: true } },
      },
    });
    if (!membership) throw new NotFoundException('Miembro no encontrado');
    return membership;
  }

  /** Evita dejar el club sin ningún Dueño activo — nadie podría administrarlo más. */
  private async assertNotLastOwner(clubId: string, excludingMembershipId: string): Promise<void> {
    const otherOwners = await this.prisma.db.membership.count({
      where: {
        clubId,
        status: 'ACTIVE',
        deletedAt: null,
        id: { not: excludingMembershipId },
        role: { code: 'OWNER' },
      },
    });
    if (otherOwners === 0) {
      throw new BadRequestException('El club necesita al menos un Dueño activo');
    }
  }

  private async audit(
    clubId: string,
    actorUserId: string | null,
    action: 'CREATE' | 'PERMISSION_CHANGE' | 'DELETE',
    entityId: string,
    changes?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.db.auditLog.create({
      data: {
        clubId,
        userId: actorUserId,
        action,
        entityType: 'Membership',
        entityId,
        ...(changes ? { changes: changes as never } : {}),
      },
    });
  }
}
