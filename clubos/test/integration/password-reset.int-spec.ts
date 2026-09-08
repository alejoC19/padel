/**
 * "Olvidé mi contraseña" y aceptación de invitación de staff (AuthService),
 * contra Postgres real. Antes de este cambio no existía ningún camino de
 * recuperación: una cuenta bloqueada quedaba bloqueada para siempre, y no
 * había forma de fijar contraseña para una cuenta creada por invitación
 * (ver team.int-spec.ts) sin pasarle la contraseña a mano.
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../src/prisma/prisma.service';
import { runWithTenant, runWithoutTenancy } from '../../src/tenancy/tenant-context';
import { PERMISSIONS, ROLE_PRESETS, type Permission } from '../../src/common/permissions';
import { AuthService } from '../../src/auth/auth.service';
import { TokenService } from '../../src/auth/token.service';
import { EmailChannel } from '../../src/notifications/services/channels/email.channel';
import { generateSecureToken } from '../../src/common/utils/secure-token.util';

const HAS_DB = Boolean(process.env.DATABASE_URL_TEST);
const d = HAS_DB ? describe : describe.skip;

const noopConfig = { get: () => undefined } as unknown as ConfigService;

function ctx(clubId: string) {
  return {
    clubId,
    userId: null,
    membershipId: null,
    roleCode: 'TEST',
    permissions: new Set<Permission>(Object.values(PERMISSIONS) as Permission[]),
    isPlatformAdmin: false,
    requestId: randomUUID(),
    bypassTenancy: false,
  };
}

d('Recuperación de contraseña y aceptación de invitación (AuthService)', () => {
  let prisma: PrismaService;
  let auth: AuthService;
  let clubId: string;
  let roleId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    process.env.JWT_ACCESS_SECRET ??= 'test-secret-password-reset';
    prisma = new PrismaService();
    await prisma.onModuleInit();
    const tokens = new TokenService(new JwtService({}), prisma);
    auth = new AuthService(prisma, tokens, noopConfig, new EmailChannel(noopConfig));

    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan-reset' },
        update: {},
        create: {
          code: 'test-plan-reset', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });
      const club = await prisma.club.create({
        data: { slug: `test-reset-${Date.now()}`, name: 'Club Reset', planId: plan.id, status: 'ACTIVE' },
      });
      clubId = club.id;
      const role = await prisma.db.role.create({
        data: { clubId, code: 'RECEPTION', name: 'Recepción', permissions: ROLE_PRESETS.RECEPTION as string[], isSystem: true },
      });
      roleId = role.id;
    });
  }, 30_000);

  afterAll(async () => {
    if (prisma) await prisma.onModuleDestroy();
  });

  it('forgotPassword no revela si el email existe (mismo resultado, exista o no)', async () => {
    await expect(auth.forgotPassword({ email: `no-existe-${randomUUID()}@test.com` })).resolves.toBeUndefined();
  });

  it('forgotPassword crea un token de un solo uso, vigente por 1 hora', async () => {
    const email = `reset-${randomUUID().slice(0, 8)}@test.com`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash('Cualquiera1', 10), firstName: 'Res', lastName: 'Et' },
    });

    await auth.forgotPassword({ email });

    const token = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: user.id, purpose: 'RESET' },
    });
    expect(token.usedAt).toBeNull();
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(token.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 61 * 60_000);
  });

  it('resetPassword: cambia la contraseña con un token válido y lo invalida tras usarlo', async () => {
    const email = `reset2-${randomUUID().slice(0, 8)}@test.com`;
    const oldHash = await bcrypt.hash('ContraseñaVieja1', 10);
    const user = await prisma.user.create({
      data: { email, passwordHash: oldHash, firstName: 'Res', lastName: 'Et' },
    });
    const { raw, hash } = generateSecureToken();
    const token = await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hash, purpose: 'RESET', expiresAt: new Date(Date.now() + 60_000) },
    });

    await auth.resetPassword({ token: raw, newPassword: 'ContraseñaNueva1' });

    const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare('ContraseñaNueva1', reloaded.passwordHash!)).toBe(true);
    expect(await bcrypt.compare('ContraseñaVieja1', reloaded.passwordHash!)).toBe(false);

    const usedToken = await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(usedToken.usedAt).not.toBeNull();

    // Un segundo uso del mismo token debe rechazarse.
    await expect(auth.resetPassword({ token: raw, newPassword: 'OtraMas123' })).rejects.toThrow(
      'El link venció o ya fue usado',
    );
  });

  it('acceptInvite fija contraseña, activa la membership y devuelve sesión', async () => {
    const email = `invitado-${randomUUID().slice(0, 8)}@test.com`;
    const user = await prisma.user.create({
      data: { email, passwordHash: null, firstName: 'Invi', lastName: 'Tado', emailVerified: false },
    });
    await runWithTenant(ctx(clubId), async () => {
      await prisma.db.membership.create({
        data: { clubId, userId: user.id, roleId, status: 'INVITED', invitedAt: new Date() },
      });
    });
    const { raw, hash } = generateSecureToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id, tokenHash: hash, purpose: 'INVITE',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const response = await auth.acceptInvite({ token: raw, password: 'MiContraseña1' }, {});

    expect(response.accessToken).toEqual(expect.any(String));
    expect(response.activeClub?.id).toBe(clubId);

    const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reloaded.passwordHash).not.toBeNull();
    expect(reloaded.emailVerified).toBe(true);

    const membership = await runWithTenant(ctx(clubId), async () =>
      prisma.db.membership.findUniqueOrThrow({ where: { clubId_userId: { clubId, userId: user.id } } }),
    );
    expect(membership.status).toBe('ACTIVE');
    expect(membership.acceptedAt).not.toBeNull();
  });
});
