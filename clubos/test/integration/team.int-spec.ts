/**
 * Alta y administración de staff (TeamService) — contra Postgres real.
 *
 * Cubre el flujo completo que faltaba por completo antes de este cambio: el
 * schema ya traía `MembershipStatus.INVITED` pero nada lo usaba, así que el
 * único usuario posible de un club era su dueño (onboarding). Este test
 * prueba:
 *   1. Invitar a alguien SIN cuenta → User sin contraseña + Membership INVITED.
 *   2. Invitar a alguien QUE YA TIENE cuenta (de otro club) → Membership ACTIVE
 *      directo, sin tocar su contraseña.
 *   3. No se puede invitar dos veces a la misma persona al mismo club.
 *   4. Un ADMIN (tiene `user.invite` pero no debería poder crear otros OWNER)
 *      no puede asignar el rol OWNER — solo un OWNER puede.
 *   5. No se puede dejar un club sin ningún OWNER activo (ni degradándolo ni
 *      revocando su membership).
 *   6. Nadie puede quitarse a sí mismo del club.
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { runWithTenant, runWithoutTenancy } from '../../src/tenancy/tenant-context';
import { PERMISSIONS, ROLE_PRESETS, type Permission } from '../../src/common/permissions';
import { TeamService } from '../../src/team/services/team.service';
import { EmailChannel } from '../../src/notifications/services/channels/email.channel';

const HAS_DB = Boolean(process.env.DATABASE_URL_TEST);
const d = HAS_DB ? describe : describe.skip;

const noopConfig = { get: () => undefined } as unknown as ConfigService;

function ctx(clubId: string, userId: string, roleCode: string, isPlatformAdmin = false) {
  return {
    clubId,
    userId,
    membershipId: null,
    roleCode,
    permissions: new Set<Permission>(ROLE_PRESETS[roleCode] ?? []),
    isPlatformAdmin,
    requestId: randomUUID(),
    bypassTenancy: false,
  };
}

d('Alta y administración de staff (TeamService)', () => {
  let prisma: PrismaService;
  let team: TeamService;
  let clubId: string;
  let ownerUserId: string;
  let ownerMembershipId: string;
  let roleIds: Record<string, string>;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    team = new TeamService(prisma, noopConfig, new EmailChannel(noopConfig));

    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan-team' },
        update: {},
        create: {
          code: 'test-plan-team', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });
      const club = await prisma.club.create({
        data: { slug: `test-team-${Date.now()}`, name: 'Club Team', planId: plan.id, status: 'ACTIVE' },
      });
      clubId = club.id;

      roleIds = {};
      for (const code of ['OWNER', 'ADMIN', 'RECEPTION'] as const) {
        const role = await prisma.db.role.create({
          data: { clubId, code, name: code, permissions: ROLE_PRESETS[code] as string[], isSystem: true },
        });
        roleIds[code] = role.id;
      }

      const bcrypt = await import('bcryptjs');
      const owner = await prisma.user.create({
        data: {
          email: `team-owner-${Date.now()}@test.com`,
          passwordHash: await bcrypt.hash('Owner1234!', 10),
          firstName: 'Due', lastName: 'Ño',
        },
      });
      ownerUserId = owner.id;
      createdUserIds.push(owner.id);

      const membership = await prisma.db.membership.create({
        data: { clubId, userId: ownerUserId, roleId: roleIds.OWNER, status: 'ACTIVE' },
      });
      ownerMembershipId = membership.id;
    });
  }, 30_000);

  afterAll(async () => {
    if (!prisma) return;
    // No se puede hacer DELETE en cascada del club: invitar/gestionar staff
    // escribe en audit_logs, que es append-only (trigger de Postgres lo
    // rechaza a propósito, ver 001_integrity_and_rls.sql). Es una base de
    // test descartable — se deja el club y los usuarios creados, mismo
    // criterio que cash-concurrency.int-spec.ts.
    await prisma.onModuleDestroy();
  });

  it('invita a alguien sin cuenta: queda INVITED con la cuenta sin contraseña', async () => {
    const email = `nuevo-${randomUUID().slice(0, 8)}@test.com`;
    const result = await runWithTenant(ctx(clubId, ownerUserId, 'OWNER'), async () =>
      team.invite(ctx(clubId, ownerUserId, 'OWNER'), {
        email, firstName: 'Nueva', lastName: 'Persona', roleId: roleIds.RECEPTION,
      }),
    );
    expect(result.status).toBe('INVITED');

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    createdUserIds.push(user.id);
    expect(user.passwordHash).toBeNull();

    const membership = await runWithTenant(ctx(clubId, ownerUserId, 'OWNER'), async () =>
      prisma.db.membership.findUniqueOrThrow({ where: { clubId_userId: { clubId, userId: user.id } } }),
    );
    expect(membership.status).toBe('INVITED');

    const token = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(token.purpose).toBe('INVITE');
  });

  it('invita a alguien que ya tiene cuenta: se agrega ACTIVE sin tocar su contraseña', async () => {
    const bcrypt = await import('bcryptjs');
    const existingHash = await bcrypt.hash('YaTengoCuenta1', 10);
    const existing = await prisma.user.create({
      data: {
        email: `existente-${randomUUID().slice(0, 8)}@test.com`,
        passwordHash: existingHash,
        firstName: 'Ya', lastName: 'Existo',
      },
    });
    createdUserIds.push(existing.id);

    const result = await runWithTenant(ctx(clubId, ownerUserId, 'OWNER'), async () =>
      team.invite(ctx(clubId, ownerUserId, 'OWNER'), {
        email: existing.email, firstName: existing.firstName, lastName: existing.lastName,
        roleId: roleIds.RECEPTION,
      }),
    );
    expect(result.status).toBe('ADDED');

    const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(reloaded.passwordHash).toBe(existingHash);

    const membership = await runWithTenant(ctx(clubId, ownerUserId, 'OWNER'), async () =>
      prisma.db.membership.findUniqueOrThrow({ where: { clubId_userId: { clubId, userId: existing.id } } }),
    );
    expect(membership.status).toBe('ACTIVE');
  });

  it('no permite invitar dos veces a la misma persona activa', async () => {
    const bcrypt = await import('bcryptjs');
    const existing = await prisma.user.create({
      data: {
        email: `dup-${randomUUID().slice(0, 8)}@test.com`,
        passwordHash: await bcrypt.hash('Algo1234', 10),
        firstName: 'Dup', lastName: 'Licado',
      },
    });
    createdUserIds.push(existing.id);
    const dto = { email: existing.email, firstName: 'Dup', lastName: 'Licado', roleId: roleIds.RECEPTION };

    await runWithTenant(ctx(clubId, ownerUserId, 'OWNER'), async () =>
      team.invite(ctx(clubId, ownerUserId, 'OWNER'), dto),
    );
    await expect(
      runWithTenant(ctx(clubId, ownerUserId, 'OWNER'), async () =>
        team.invite(ctx(clubId, ownerUserId, 'OWNER'), dto),
      ),
    ).rejects.toThrow('Esa persona ya es parte del club');
  });

  it('un ADMIN no puede asignar el rol OWNER (solo un OWNER puede)', async () => {
    const bcrypt = await import('bcryptjs');
    const admin = await prisma.user.create({
      data: {
        email: `admin-${randomUUID().slice(0, 8)}@test.com`,
        passwordHash: await bcrypt.hash('Admin1234', 10),
        firstName: 'Ad', lastName: 'Min',
      },
    });
    createdUserIds.push(admin.id);
    await runWithTenant(ctx(clubId, ownerUserId, 'OWNER'), async () =>
      prisma.db.membership.create({ data: { clubId, userId: admin.id, roleId: roleIds.ADMIN, status: 'ACTIVE' } }),
    );

    const targetEmail = `victima-${randomUUID().slice(0, 8)}@test.com`;
    await expect(
      runWithTenant(ctx(clubId, admin.id, 'ADMIN'), async () =>
        team.invite(ctx(clubId, admin.id, 'ADMIN'), {
          email: targetEmail, firstName: 'Vic', lastName: 'Tima', roleId: roleIds.OWNER,
        }),
      ),
    ).rejects.toThrow('Solo un Dueño puede asignar el rol de Dueño');

    // La invitación no debe haber creado nada a medio camino.
    const orphan = await prisma.user.findUnique({ where: { email: targetEmail } });
    expect(orphan).toBeNull();
  });

  it('no se puede degradar ni revocar al único OWNER activo', async () => {
    await expect(
      runWithTenant(ctx(clubId, ownerUserId, 'OWNER'), async () =>
        team.update(ctx(clubId, ownerUserId, 'OWNER'), ownerMembershipId, { roleId: roleIds.ADMIN }),
      ),
    ).rejects.toThrow('El club necesita al menos un Dueño activo');

    await expect(
      runWithTenant(ctx(clubId, ownerUserId, 'OWNER'), async () =>
        team.remove(ctx(clubId, ownerUserId, 'OWNER'), ownerMembershipId),
      ),
    ).rejects.toThrow(/Dueño|vos mismo/);
  });

  it('nadie puede quitarse a sí mismo del club', async () => {
    const bcrypt = await import('bcryptjs');
    const admin2 = await prisma.user.create({
      data: {
        email: `admin2-${randomUUID().slice(0, 8)}@test.com`,
        passwordHash: await bcrypt.hash('Admin1234', 10),
        firstName: 'Ad', lastName: 'Min2',
      },
    });
    createdUserIds.push(admin2.id);
    const membership = await runWithTenant(ctx(clubId, ownerUserId, 'OWNER'), async () =>
      prisma.db.membership.create({ data: { clubId, userId: admin2.id, roleId: roleIds.ADMIN, status: 'ACTIVE' } }),
    );

    await expect(
      runWithTenant(ctx(clubId, admin2.id, 'ADMIN'), async () =>
        team.remove(ctx(clubId, admin2.id, 'ADMIN'), membership.id),
      ),
    ).rejects.toThrow('No podés quitarte a vos mismo del club');
  });
});
