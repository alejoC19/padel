/**
 * `PaymentService.register()` asentaba TODO pago (efectivo/tarjeta cobrado
 * al momento, sin fiado de por medio) como un asiento positivo en la cuenta
 * corriente del cliente — sin importar si esa reserva/venta había generado
 * alguna deuda. Un cliente que simplemente paga su reserva y compra algo en
 * el buffet termina con un "saldo a favor" que nunca depositó: no vino de
 * ningún lado, y se puede gastar de nuevo cargando una reserva DISTINTA a
 * cuenta corriente (`chargeToAccount`) sin que entre un peso real — la
 * reserva nueva queda resuelta y el club se queda sin cobrarla.
 *
 * Encontrado en una prueba manual de punta a punta (dueño de club real:
 * crear club → cliente → reservar → cobrar → comprar en el buffet →
 * mirar la ficha del cliente → "$X a favor" sin ningún depósito real).
 *
 * El fix: el pago solo entra a la cuenta corriente si existe un asiento
 * CHARGE previo para esa misma reserva/venta (`chargeToAccount` ya la dejó
 * ahí) — es decir, si este pago realmente está saldando una deuda. Un pago
 * directo, sin fiado, no toca la cuenta corriente en absoluto.
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
import { PaymentService } from '../../src/bookings/services/payment.service';
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

d('Cuenta corriente: un pago directo no genera crédito fantasma', () => {
  let prisma: PrismaService;
  let bookings: BookingService;
  let payments: PaymentService;
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
    payments = moduleRef.get(PaymentService);

    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan-phantom-credit' },
        update: {},
        create: {
          code: 'test-plan-phantom-credit', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });
      const club = await prisma.club.create({
        data: { slug: `test-phantom-credit-${Date.now()}`, name: 'Club Phantom Credit', planId: plan.id, status: 'ACTIVE' },
      });
      clubId = club.id;

      const user = await prisma.user.create({
        data: {
          email: `phantom-credit-${randomUUID()}@example.com`,
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
        data: { clubId, firstName: 'Juan', lastName: 'Pérez', phone: '+5491100004444', creditLimit: 100_000 },
      });
      clientId = client.id;

      const method = await prisma.db.paymentMethod.create({
        data: { clubId, code: 'CASH', name: 'Efectivo', kind: 'CASH', affectsCashCount: false },
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
          clubId, code: `R-PHANTOM-${randomUUID().slice(0, 8)}`, courtId, clientId,
          status: 'CONFIRMED',
          startsAt: new Date(start), endsAt: new Date(start + 3_600_000),
          durationMinutes: 60, totalPrice: 32_000, paidAmount: 0, paymentStatus: 'UNPAID',
        },
      });
    });
  }

  it('cobrar una reserva de contado no deja saldo a favor en la cuenta corriente', async () => {
    const booking = await makeBooking(86_400_000);

    await runWithTenant(ctx(clubId), async () =>
      bookings.collect(booking.id, { paymentMethodId: methodId, amount: 32_000 }, clubId, userId),
    );

    const client = await runWithTenant(ctx(clubId), async () =>
      prisma.db.client.findUniqueOrThrow({ where: { id: clientId } }),
    );
    expect(Number(client.accountBalance)).toBe(0);
  }, 20_000);

  it('sin deuda real, no se puede cargar una reserva nueva a cuenta corriente usando el saldo', async () => {
    const secondBooking = await makeBooking(172_800_000);

    // El saldo sigue en 0 (test anterior): cargar esta reserva a cuenta
    // corriente exige deuda/límite disponible real, no crédito fantasma.
    await runWithTenant(ctx(clubId), async () =>
      payments.chargeToAccount(prisma.db as never, {
        clubId, clientId, amount: 32_000,
        concept: 'Reserva a cuenta', bookingId: secondBooking.id,
      }),
    );

    const client = await runWithTenant(ctx(clubId), async () =>
      prisma.db.client.findUniqueOrThrow({ where: { id: clientId } }),
    );
    // La deuda es real: el saldo bajó a -32.000 (dentro del creditLimit de
    // 100.000), no se "absorbió" con ningún crédito que no existía.
    expect(Number(client.accountBalance)).toBe(-32_000);
  }, 20_000);

  it('pagar esa deuda real sí acredita la cuenta corriente (neteo correcto)', async () => {
    const thirdBooking = await makeBooking(259_200_000);
    await runWithTenant(ctx(clubId), async () =>
      payments.chargeToAccount(prisma.db as never, {
        clubId, clientId, amount: 5_000,
        concept: 'Reserva a cuenta 2', bookingId: thirdBooking.id,
      }),
    );

    await runWithTenant(ctx(clubId), async () =>
      bookings.collect(thirdBooking.id, { paymentMethodId: methodId, amount: 5_000 }, clubId, userId),
    );

    const client = await runWithTenant(ctx(clubId), async () =>
      prisma.db.client.findUniqueOrThrow({ where: { id: clientId } }),
    );
    // -32.000 (deuda anterior, sin pagar) + 0 (esta deuda de 5.000 recién
    // pagada, neteada a cero) = -32.000: pagar SÍ mueve el ledger cuando
    // hay una deuda real de por medio a la que aplicar el pago.
    expect(Number(client.accountBalance)).toBe(-32_000);
  }, 20_000);
});
