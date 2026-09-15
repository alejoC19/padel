/**
 * `collect()` no debe aceptar cobros sobre una reserva cancelada/ausente/
 * reprogramada.
 *
 * `totalPrice`/`paidAmount` de una reserva NO cambian al cancelarla o
 * marcarla como ausente — lo que cambia es `cancellationFee` (calculado
 * aparte por la política de cancelación) o el cargo a cuenta corriente del
 * no-show. Sin este freno, `collect()` seguía viendo saldo pendiente contra
 * el precio ORIGINAL completo y dejaba cobrar de más sobre una reserva que
 * ya no va a jugarse — muy por encima de lo que la política dice que
 * corresponde.
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { BookingsModule } from '../../src/bookings/bookings.module';
import { BookingService } from '../../src/bookings/services/booking.service';
import { runWithTenant, runWithoutTenancy } from '../../src/tenancy/tenant-context';
import { PERMISSIONS, type Permission } from '../../src/common/permissions';

const HAS_DB = Boolean(process.env.DATABASE_URL_TEST);
const d = HAS_DB ? describe : describe.skip;

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

d('collect() rechaza reservas en estado no cobrable', () => {
  let prisma: PrismaService;
  let bookings: BookingService;
  let clubId: string;
  let userId: string;
  let courtId: string;
  let clientId: string;
  let methodId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, BookingsModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    bookings = moduleRef.get(BookingService);

    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan-collect-guard' },
        update: {},
        create: {
          code: 'test-plan-collect-guard', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });
      const club = await prisma.club.create({
        data: { slug: `test-collect-guard-${Date.now()}`, name: 'Club Collect Guard', planId: plan.id, status: 'ACTIVE' },
      });
      clubId = club.id;

      const user = await prisma.user.create({
        data: {
          email: `collect-guard-${randomUUID()}@example.com`,
          passwordHash: 'x', firstName: 'Test', lastName: 'User',
        },
      });
      userId = user.id;
    });

    await runWithTenant(ctx(clubId), async () => {
      const sport = await prisma.db.sport.create({ data: { clubId, code: 'PADEL', name: 'Pádel' } });
      const court = await prisma.db.court.create({
        data: { clubId, sportId: sport.id, name: 'Cancha 1', number: 1, status: 'AVAILABLE' },
      });
      courtId = court.id;

      const client = await prisma.db.client.create({
        data: {
          clubId, firstName: 'Cliente', lastName: 'Test', phone: '+5491100003333',
          // El no-show carga el cargo a cuenta corriente: sin límite, el
          // cargo lo rechaza por "supera el límite de crédito".
          creditLimit: 100_000,
        },
      });
      clientId = client.id;

      const method = await prisma.db.paymentMethod.create({
        data: { clubId, code: 'TRANSFER', name: 'Transferencia', kind: 'BANK_TRANSFER', affectsCashCount: false },
      });
      methodId = method.id;
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.onModuleDestroy();
  });

  async function makeBooking(startOffsetMs: number) {
    return runWithTenant(ctx(clubId), async () => {
      const start = Date.now() + startOffsetMs;
      return prisma.db.booking.create({
        data: {
          clubId, code: `R-COLLECT-${randomUUID().slice(0, 8)}`, courtId, clientId,
          status: 'CONFIRMED',
          startsAt: new Date(start), endsAt: new Date(start + 3_600_000),
          durationMinutes: 60, totalPrice: 10_000, paidAmount: 0, paymentStatus: 'UNPAID',
        },
      });
    });
  }

  it('una reserva cancelada por el cliente no admite un cobro nuevo', async () => {
    const booking = await makeBooking(86_400_000);

    await runWithTenant(ctx(clubId), async () =>
      bookings.cancel(booking.id, { cancelledBy: 'CLIENT' }, clubId, userId),
    );

    await expect(
      runWithTenant(ctx(clubId), async () =>
        bookings.collect(booking.id, { paymentMethodId: methodId, amount: 5_000 }, clubId, userId),
      ),
    ).rejects.toThrow(/no admite más cobros/);
  }, 20_000);

  it('una reserva marcada como ausencia no admite un cobro nuevo', async () => {
    // Empieza en el pasado: markNoShow no exige que ya haya pasado el
    // horario, pero usar una fecha pasada deja el escenario realista.
    const booking = await makeBooking(-3_600_000);

    await runWithTenant(ctx(clubId), async () =>
      bookings.markNoShow(booking.id, clubId, userId),
    );

    await expect(
      runWithTenant(ctx(clubId), async () =>
        bookings.collect(booking.id, { paymentMethodId: methodId, amount: 5_000 }, clubId, userId),
      ),
    ).rejects.toThrow(/no admite más cobros/);
  }, 20_000);

  it('una reserva CONFIRMED (sin cancelar) sí admite el cobro', async () => {
    const booking = await makeBooking(172_800_000);

    const result = await runWithTenant(ctx(clubId), async () =>
      bookings.collect(booking.id, { paymentMethodId: methodId, amount: 4_000 }, clubId, userId),
    );

    expect(result.paidAmount).toBe(4_000);
  }, 20_000);
});
