/**
 * Test de vencimiento de trial.
 *
 * `Club.trialEndsAt` no servía de nada si nada lo leía. Este test crea un
 * club en TRIAL ya vencido y uno vigente, corre el job, y verifica que solo
 * el vencido pasa a SUSPENDED — y que TenantGuard (probado en otro lado)
 * bloquea justamente ese estado.
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TrialExpiryService } from '../../src/billing/services/trial-expiry.service';
import { runWithoutTenancy } from '../../src/tenancy/tenant-context';

const HAS_DB = Boolean(process.env.DATABASE_URL_TEST);
const d = HAS_DB ? describe : describe.skip;

d('Vencimiento de trial', () => {
  let prisma: PrismaService;
  let service: TrialExpiryService;
  let expiredClubId: string;
  let activeClubId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new TrialExpiryService(prisma);

    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan-trial' },
        update: {},
        create: {
          code: 'test-plan-trial', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });

      const expired = await prisma.club.create({
        data: {
          slug: `test-expired-${Date.now()}`, name: 'Club Vencido',
          planId: plan.id, status: 'TRIAL',
          trialEndsAt: new Date(Date.now() - 24 * 3_600_000), // ayer
        },
      });
      expiredClubId = expired.id;

      const active = await prisma.club.create({
        data: {
          slug: `test-active-${Date.now()}`, name: 'Club Vigente',
          planId: plan.id, status: 'TRIAL',
          trialEndsAt: new Date(Date.now() + 13 * 86_400_000), // en 13 días
        },
      });
      activeClubId = active.id;
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.onModuleDestroy();
  });

  it('suspende solo los clubes con trial vencido', async () => {
    await (service as unknown as { expireTrials: () => Promise<void> }).expireTrials();

    const [expired, active] = await runWithoutTenancy(randomUUID(), () =>
      Promise.all([
        prisma.club.findUniqueOrThrow({ where: { id: expiredClubId }, select: { status: true } }),
        prisma.club.findUniqueOrThrow({ where: { id: activeClubId }, select: { status: true } }),
      ]),
    );

    expect(expired.status).toBe('SUSPENDED');
    expect(active.status).toBe('TRIAL');
  }, 20_000);
});
