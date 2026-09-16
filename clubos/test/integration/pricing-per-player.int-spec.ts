/**
 * El pádel se juega siempre de a 4 (dobles): la tarifa que carga el club en
 * su lista de precios es POR JUGADOR, y lo que se cobra por el turno es esa
 * tarifa × 4 — no lo que el club escribió tal cual. Antes de este fix,
 * `PricingService.quote()` cobraba el número cargado directamente como si
 * ya fuera el total del turno (1x, no 4x).
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PricingService } from '../../src/bookings/services/pricing.service';
import { runWithTenant, runWithoutTenancy } from '../../src/tenancy/tenant-context';

const HAS_DB = Boolean(process.env.DATABASE_URL_TEST);
const d = HAS_DB ? describe : describe.skip;

function ctx(clubId: string) {
  return {
    clubId,
    userId: null,
    membershipId: null,
    roleCode: 'TEST',
    permissions: new Set<never>(),
    isPlatformAdmin: false,
    requestId: randomUUID(),
    bypassTenancy: false,
  };
}

d('Precio por jugador × 4', () => {
  let prisma: PrismaService;
  let pricing: PricingService;
  let clubId: string;
  let courtId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    pricing = new PricingService(prisma);

    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan-pricing' },
        update: {},
        create: {
          code: 'test-plan-pricing', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });
      const club = await prisma.club.create({
        data: { slug: `test-pricing-${Date.now()}`, name: 'Club Pricing Test', planId: plan.id, status: 'ACTIVE' },
      });
      clubId = club.id;
    });

    await runWithTenant(ctx(clubId), async () => {
      const sport = await prisma.db.sport.create({ data: { clubId, code: 'PADEL', name: 'Pádel' } });
      const court = await prisma.db.court.create({
        data: { clubId, sportId: sport.id, name: 'Cancha 1', number: 1 },
      });
      courtId = court.id;

      const priceList = await prisma.db.priceList.create({
        data: { clubId, name: 'Default', isDefault: true, isActive: true },
      });

      // $8.000 cargados = por jugador. El turno debería cobrar $32.000.
      await prisma.db.priceRule.create({
        data: { clubId, priceListId: priceList.id, price: 8_000 },
      });
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await runWithoutTenancy(randomUUID(), async () => {
      await prisma.club.deleteMany({ where: { id: clubId } });
    });
    await prisma.onModuleDestroy();
  });

  it('cobra basePrice × 4, no basePrice tal cual', async () => {
    const quote = await runWithTenant(ctx(clubId), async () =>
      pricing.quote({
        courtId,
        startsAt: new Date('2026-10-15T18:00:00Z'),
        durationMinutes: 60,
        timezone: 'America/Argentina/Buenos_Aires',
      }),
    );

    expect(quote.basePrice).toBe(8_000);
    expect(quote.courtPrice).toBe(32_000);
    expect(quote.totalPrice).toBe(32_000);
  });

  it('el descuento del cliente se aplica sobre el total (×4), no sobre la tarifa por jugador', async () => {
    const clientId = await runWithTenant(ctx(clubId), async () => {
      const client = await prisma.db.client.create({
        data: { clubId, firstName: 'Con', lastName: 'Descuento', discountPercent: 10 },
      });
      return client.id;
    });

    const quote = await runWithTenant(ctx(clubId), async () =>
      pricing.quote({
        courtId,
        startsAt: new Date('2026-10-15T18:00:00Z'),
        durationMinutes: 60,
        clientId,
        timezone: 'America/Argentina/Buenos_Aires',
      }),
    );

    // 10% de $32.000 = $3.200 → total $28.800. Si el descuento se hubiera
    // aplicado por error sobre los $8.000 por jugador, el total habría
    // quedado en $31.200 (32.000 - 800) en vez de $28.800.
    expect(quote.discountAmount).toBe(3_200);
    expect(quote.totalPrice).toBe(28_800);
  });
});
