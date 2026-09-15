/**
 * Un reembolso de Mercado Pago NUNCA debe considerarse exitoso sin que MP lo
 * confirme.
 *
 * `MercadoPagoClient.refund()` (POST /v1/payments/{id}/refunds) existe pero
 * NINGÚN camino de código lo llama — no hay integración real de reembolso
 * online. Antes, `PaymentService.refund()` marcaba cualquier pago como
 * REFUNDED (afecta cuenta corriente, etc.) sin importar el gateway: para un
 * pago de MP eso es mentirle a la contabilidad, porque la plata nunca salió
 * de la cuenta de MP del club.
 *
 * Este test prueba que:
 *   1. Un reembolso "de un usuario del panel" sobre un pago de MP se
 *      RECHAZA — el Payment queda intacto (status/refundedAmount sin tocar).
 *   2. El ÚNICO camino que sí marca REFUNDED es pasando
 *      `confirmedByGateway: true` — reservado para cuando el webhook de MP
 *      avisa que MP mismo ya devolvió la plata (ver
 *      `PaymentOrderService.handleWebhook`).
 *   3. Cancelar una reserva pagada con Mercado Pago (BookingService.cancel,
 *      camino normal de un cajero) NO marca ese pago como reembolsado — el
 *      monto queda pendiente de que el club lo procese a mano en su panel
 *      de Mercado Pago.
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

d('Un reembolso de Mercado Pago no se marca exitoso sin confirmación real', () => {
  let prisma: PrismaService;
  let bookings: BookingService;
  let payments: PaymentService;
  let clubId: string;
  let userId: string;
  let courtId: string;
  let clientId: string;
  let mpMethodId: string;

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
        where: { code: 'test-plan-mp-refund-real' },
        update: {},
        create: {
          code: 'test-plan-mp-refund-real', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });
      const club = await prisma.club.create({
        data: { slug: `test-mp-refund-real-${Date.now()}`, name: 'Club MP Refund Real', planId: plan.id, status: 'ACTIVE' },
      });
      clubId = club.id;

      const user = await prisma.user.create({
        data: {
          email: `mp-refund-real-${randomUUID()}@example.com`,
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
        data: { clubId, firstName: 'Cliente', lastName: 'MP', phone: '+5491100004444' },
      });
      clientId = client.id;

      const method = await prisma.db.paymentMethod.create({
        data: { clubId, code: 'MP', name: 'Mercado Pago', kind: 'MERCADO_PAGO', affectsCashCount: false },
      });
      mpMethodId = method.id;
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.onModuleDestroy();
  });

  async function makeMpPayment(amount: number) {
    return runWithTenant(ctx(clubId), async () =>
      prisma.db.payment.create({
        data: {
          clubId, code: `PAG-MP-${randomUUID().slice(0, 8)}`, methodId: mpMethodId,
          amount, netAmount: amount, status: 'COMPLETED',
          gatewayProvider: 'MERCADO_PAGO', clientId,
        },
      }),
    );
  }

  it('rechaza el reembolso de un pago de MP sin confirmación del gateway', async () => {
    const payment = await makeMpPayment(5_000);

    await expect(
      runWithTenant(ctx(clubId), async () =>
        prisma.tenantTransaction((tx) =>
          payments.refund(tx, {
            clubId, paymentId: payment.id, amount: 5_000,
            reason: 'Prueba: reembolso desde el panel',
          }),
        ),
      ),
    ).rejects.toThrow(/no reembolsa online por Mercado Pago/);

    // El pago queda EXACTAMENTE como estaba: nada de "reembolsado a medias".
    const fresh = await runWithTenant(ctx(clubId), async () =>
      prisma.db.payment.findUniqueOrThrow({ where: { id: payment.id } }),
    );
    expect(fresh.status).toBe('COMPLETED');
    expect(Number(fresh.refundedAmount)).toBe(0);
  }, 20_000);

  it('acepta el reembolso de MP SOLO con confirmedByGateway (webhook real de MP)', async () => {
    const payment = await makeMpPayment(5_000);

    await runWithTenant(ctx(clubId), async () =>
      prisma.tenantTransaction((tx) =>
        payments.refund(tx, {
          clubId, paymentId: payment.id, amount: 5_000,
          reason: 'Prueba: MP confirmó el reembolso por webhook',
          confirmedByGateway: true,
        }),
      ),
    );

    const fresh = await runWithTenant(ctx(clubId), async () =>
      prisma.db.payment.findUniqueOrThrow({ where: { id: payment.id } }),
    );
    expect(fresh.status).toBe('REFUNDED');
    expect(Number(fresh.refundedAmount)).toBe(5_000);
  }, 20_000);

  it('cancelar una reserva pagada con MP no marca el pago como reembolsado', async () => {
    const start = Date.now() + 86_400_000;
    const booking = await runWithTenant(ctx(clubId), async () =>
      prisma.db.booking.create({
        data: {
          clubId, code: `R-MP-REFUND-${randomUUID().slice(0, 8)}`, courtId, clientId,
          status: 'CONFIRMED',
          startsAt: new Date(start), endsAt: new Date(start + 3_600_000),
          durationMinutes: 60, totalPrice: 10_000, paidAmount: 10_000, paymentStatus: 'PAID',
        },
      }),
    );

    const payment = await runWithTenant(ctx(clubId), async () =>
      prisma.db.payment.create({
        data: {
          clubId, code: `PAG-MP-BK-${randomUUID().slice(0, 8)}`, methodId: mpMethodId,
          amount: 10_000, netAmount: 10_000, status: 'COMPLETED',
          gatewayProvider: 'MERCADO_PAGO', clientId, bookingId: booking.id,
        },
      }),
    );

    // Cancelación normal de staff (autoRefund por defecto = true). Antes de
    // la corrección, esto llamaba a payments.refund() sobre el pago de MP y
    // lo marcaba REFUNDED sin que la plata realmente volviera.
    const result = await runWithTenant(ctx(clubId), async () =>
      bookings.cancel(booking.id, { cancelledBy: 'CLIENT' }, clubId, userId),
    );

    const freshPayment = await runWithTenant(ctx(clubId), async () =>
      prisma.db.payment.findUniqueOrThrow({ where: { id: payment.id } }),
    );
    // El pago de MP sigue COMPLETED: nadie le devolvió la plata todavía.
    expect(freshPayment.status).toBe('COMPLETED');
    expect(Number(freshPayment.refundedAmount)).toBe(0);
    // La reserva no puede afirmar que devolvió lo que no devolvió.
    expect(result.refundAmount).toBe(0);
  }, 20_000);
});
