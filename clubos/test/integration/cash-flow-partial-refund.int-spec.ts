/**
 * La proyección de flujo de fondos no debe contar como ingreso plata que ya
 * se devolvió.
 *
 * Un pago con tarjeta que todavía no liquidó (`settledAt` nulo) puede
 * quedar PARTIALLY_REFUNDED antes de esa liquidación — por ejemplo, se
 * canceló parte de la reserva antes de que el banco acredite. El neto que
 * el banco va a depositar ya no es el neto completo: hay que prorratear lo
 * reembolsado. Sin eso, la proyección le dice al club que le va a entrar
 * plata que en realidad ya volvió al cliente.
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TreasuryModule } from '../../src/treasury/treasury.module';
import { CashFlowService } from '../../src/treasury/services/cash-flow.service';
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

d('Cash-flow: un pago parcialmente reembolsado antes de liquidar prorratea el ingreso', () => {
  let prisma: PrismaService;
  let cashFlow: CashFlowService;
  let clubId: string;
  let methodId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, TreasuryModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    cashFlow = moduleRef.get(CashFlowService);

    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan-cashflow-refund' },
        update: {},
        create: {
          code: 'test-plan-cashflow-refund', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });
      const club = await prisma.club.create({
        data: { slug: `test-cashflow-refund-${Date.now()}`, name: 'Club Cashflow Refund', planId: plan.id, status: 'ACTIVE' },
      });
      clubId = club.id;
    });

    await runWithTenant(ctx(clubId), async () => {
      const method = await prisma.db.paymentMethod.create({
        data: { clubId, code: 'CREDIT', name: 'Tarjeta de crédito', kind: 'CREDIT_CARD', affectsCashCount: false },
      });
      methodId = method.id;
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.onModuleDestroy();
  });

  function inDays(n: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  it('descuenta lo reembolsado del ingreso proyectado del día de liquidación', async () => {
    await runWithTenant(ctx(clubId), async () => {
      // $10.000 cobrados, comisión de $300 → neto $9.700. Se reembolsó
      // $4.000 de los $10.000 brutos (40%) antes de liquidar: el neto que
      // realmente va a entrar es 9.700 * (10.000 - 4.000) / 10.000 = 5.820.
      await prisma.db.payment.create({
        data: {
          clubId, code: `PAY-REFUND-${randomUUID().slice(0, 8)}`, methodId,
          amount: 10_000, feeAmount: 300, netAmount: 9_700,
          refundedAmount: 4_000, status: 'PARTIALLY_REFUNDED',
          settledAt: null, settlementDate: new Date(`${inDays(5)}T00:00:00Z`),
        },
      });
    });

    const projection = await runWithTenant(ctx(clubId), async () => cashFlow.project(30));

    const day = projection.days.find((d) => d.date === inDays(5));
    expect(day).toBeDefined();
    expect(day!.detail.settlements).toHaveLength(1);
    expect(day!.inflow).toBeCloseTo(5_820, 2);
  }, 20_000);
});
