/**
 * Test de idempotencia del webhook de Mercado Pago.
 *
 * MP puede (y de hecho suele) entregar el mismo webhook más de una vez —
 * reintentos propios, o dos notificaciones para el mismo evento. Sin
 * idempotencia real, procesar el mismo pago dos veces duplicaría el
 * `Payment` contable (plata que nunca cobraste apareciendo dos veces en la
 * reserva) o duplicaría el aviso al cliente.
 *
 * `PaymentOrderService.handleWebhook` ya se documenta a sí mismo como
 * "IDEMPOTENTE" y tiene el chequeo para serlo — este test prueba el
 * servicio real invocado dos veces con el mismo pago de MP (mockeado, para
 * no depender de la red), y verifica que el efecto contable ocurre UNA sola
 * vez: un solo Payment, un solo incremento de paidAmount, y no dos avisos
 * de "reserva confirmada" (ni una segunda notificación por el segundo
 * webhook, ni una duplicada por la del pago).
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PaymentsGatewayModule } from '../../src/payments-gateway/payments-gateway.module';
import { PaymentOrderService } from '../../src/payments-gateway/services/payment-order.service';
import { MercadoPagoClient } from '../../src/payments-gateway/services/mercadopago.client';
import { IntegrationService } from '../../src/payments-gateway/services/integration.service';
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

d('Idempotencia del webhook de Mercado Pago', () => {
  let prisma: PrismaService;
  let orders: PaymentOrderService;
  let clubId: string;
  let bookingId: string;
  let externalReference: string;
  // Único por corrida: Payment.gatewayPaymentId es @unique, y este test
  // corre contra una base de test persistente — un valor fijo colisionaría
  // con lo que dejó una corrida anterior.
  const PROVIDER_PAYMENT_ID = `mp-payment-idem-${randomUUID()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, PaymentsGatewayModule],
    })
      .overrideProvider(IntegrationService)
      .useValue({ getUsableAccessToken: async () => 'fake-access-token' })
      .overrideProvider(MercadoPagoClient)
      .useValue({
        getPayment: async () => ({
          id: PROVIDER_PAYMENT_ID,
          status: 'approved',
          statusDetail: 'accredited',
          externalReference,
          amount: 13_000,
          raw: { id: PROVIDER_PAYMENT_ID, status: 'approved' },
        }),
      })
      .compile();

    prisma = moduleRef.get(PrismaService);
    orders = moduleRef.get(PaymentOrderService);

    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan-mp' },
        update: {},
        create: {
          code: 'test-plan-mp', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });
      const club = await prisma.club.create({
        data: { slug: `test-mp-${Date.now()}`, name: 'Club MP Test', planId: plan.id, status: 'ACTIVE' },
      });
      clubId = club.id;
    });

    externalReference = `booking:${randomUUID()}`;

    await runWithTenant(ctx(clubId), async () => {
      const sport = await prisma.db.sport.create({ data: { clubId, code: 'PADEL', name: 'Pádel' } });
      const court = await prisma.db.court.create({
        data: { clubId, sportId: sport.id, name: 'Cancha 1', number: 1, status: 'AVAILABLE' },
      });
      const client = await prisma.db.client.create({
        data: { clubId, firstName: 'Pagador', lastName: 'Test', phone: '+5491100002222' },
      });

      const booking = await prisma.db.booking.create({
        data: {
          clubId,
          code: 'R-TEST-MP-1',
          courtId: court.id,
          clientId: client.id,
          status: 'PENDING',
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 86_400_000 + 3_600_000),
          durationMinutes: 60,
          totalPrice: 13_000,
          paidAmount: 0,
          paymentStatus: 'UNPAID',
        },
      });
      bookingId = booking.id;

      const method = await prisma.db.paymentMethod.create({
        data: {
          clubId,
          code: 'MP',
          name: 'Mercado Pago',
          kind: 'MERCADO_PAGO',
          affectsCashCount: false,
        },
      });

      const integration = await prisma.db.clubPaymentIntegration.create({
        data: { clubId, provider: 'MERCADO_PAGO', status: 'CONNECTED' },
      });

      await prisma.db.paymentOrder.create({
        data: {
          clubId,
          integrationId: integration.id,
          bookingId,
          amount: 13_000,
          concept: 'Reserva R-TEST-MP-1',
          status: 'PENDING',
          externalReference,
        },
      });

      // No se usa fuera de este bloque, pero silencia el lint de "no usado".
      void method;
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.onModuleDestroy();
  });

  it('procesar el mismo webhook dos veces registra el pago UNA sola vez', async () => {
    const first = await runWithTenant(ctx(clubId), async () =>
      orders.handleWebhook({ clubId, providerPaymentId: PROVIDER_PAYMENT_ID }),
    );
    expect(first.handled).toBe(true);

    const second = await runWithTenant(ctx(clubId), async () =>
      orders.handleWebhook({ clubId, providerPaymentId: PROVIDER_PAYMENT_ID }),
    );
    expect(second.handled).toBe(true);
    expect(second.reason).toBe('ya procesado');

    const payments = await runWithTenant(ctx(clubId), async () =>
      prisma.db.payment.findMany({ where: { clubId, bookingId } }),
    );
    expect(payments).toHaveLength(1);
    expect(Number(payments[0].amount)).toBe(13_000);

    const booking = await runWithTenant(ctx(clubId), async () =>
      prisma.db.booking.findUniqueOrThrow({ where: { id: bookingId } }),
    );
    // Un solo cobro de $13.000 sobre un total de $13.000: ni de más ni de menos.
    expect(Number(booking.paidAmount)).toBe(13_000);
    expect(booking.paymentStatus).toBe('PAID');

    const notifications = await runWithTenant(ctx(clubId), async () =>
      prisma.db.notification.findMany({
        where: { clubId, type: { in: ['PAYMENT_RECEIVED', 'BOOKING_CONFIRMED'] } },
      }),
    );
    // Un PAYMENT_RECEIVED y un BOOKING_CONFIRMED del pago aprobado — no el
    // doble, aunque handleWebhook se haya llamado dos veces.
    expect(notifications.filter((n) => n.type === 'PAYMENT_RECEIVED')).toHaveLength(1);
    expect(notifications.filter((n) => n.type === 'BOOKING_CONFIRMED')).toHaveLength(1);
  }, 20_000);
});
