/**
 * Test de conciliación bancaria: Payment vs Expense.
 *
 * `BankTransaction.reconciledWith` es polimórfico (guarda un id de Payment
 * O de Expense, según el caso). `unreconcile()` deshace "lo que hizo" la
 * conciliación — pero antes solo sabía revertir el lado Payment
 * (`settledAt = null`): para un Expense, el id no coincidía con ningún
 * Payment, el `updateMany` no tocaba nada, y el gasto quedaba marcado PAID
 * para siempre aunque la conciliación hubiera sido un error.
 *
 * Este test prueba el ciclo reconcile → unreconcile completo para ambos
 * lados, y el caso borde que motivó la corrección: un gasto que YA estaba
 * PAID (pagado por caja) antes de conciliarlo contra un movimiento bancario
 * no debe "despagarse" al desconciliar — solo se pierde el vínculo con ese
 * movimiento, no el hecho de que se pagó.
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TreasuryService } from '../../src/treasury/services/treasury.service';
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

d('Conciliación bancaria: reconcile/unreconcile (Payment vs Expense)', () => {
  let prisma: PrismaService;
  let treasury: TreasuryService;
  let clubId: string;
  let userId: string;
  let accountId: string;
  let methodId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
      providers: [TreasuryService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    treasury = moduleRef.get(TreasuryService);

    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan-treasury' },
        update: {},
        create: {
          code: 'test-plan-treasury', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });
      const club = await prisma.club.create({
        data: { slug: `test-treasury-${Date.now()}`, name: 'Club Tesorería Test', planId: plan.id, status: 'ACTIVE' },
      });
      clubId = club.id;

      const user = await prisma.user.create({
        data: {
          email: `treasury-test-${randomUUID()}@example.com`,
          passwordHash: 'x',
          firstName: 'Test', lastName: 'User',
        },
      });
      userId = user.id;
    });

    await runWithTenant(ctx(clubId), async () => {
      const account = await prisma.db.bankAccount.create({
        data: { clubId, bankName: 'Banco Test', accountName: 'Cuenta Test', currentBalance: 0 },
      });
      accountId = account.id;

      const method = await prisma.db.paymentMethod.create({
        data: {
          clubId, code: 'TRANSFER', name: 'Transferencia', kind: 'BANK_TRANSFER',
          affectsCashCount: false,
        },
      });
      methodId = method.id;
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.onModuleDestroy();
  });

  async function makeBankTx(amount: number, description: string) {
    return runWithTenant(ctx(clubId), async () =>
      prisma.db.bankTransaction.create({
        data: {
          clubId, accountId, date: new Date(), description, amount,
          fingerprint: `test-${randomUUID()}`,
        },
      }),
    );
  }

  it('Payment: reconciliar liquida el cobro y desconciliar lo revierte', async () => {
    const payment = await runWithTenant(ctx(clubId), async () =>
      prisma.db.payment.create({
        data: {
          clubId, code: `PAY-${randomUUID().slice(0, 8)}`, methodId,
          amount: 5_000, netAmount: 5_000, status: 'COMPLETED',
        },
      }),
    );
    const bankTx = await makeBankTx(5_000, 'Transferencia recibida');

    await runWithTenant(ctx(clubId), async () =>
      treasury.reconcile(bankTx.id, { kind: 'PAYMENT', id: payment.id }, clubId, userId),
    );

    let fresh = await runWithTenant(ctx(clubId), async () =>
      prisma.db.payment.findUniqueOrThrow({ where: { id: payment.id } }),
    );
    expect(fresh.settledAt).not.toBeNull();

    await runWithTenant(ctx(clubId), async () =>
      treasury.unreconcile(bankTx.id, clubId, userId),
    );

    fresh = await runWithTenant(ctx(clubId), async () =>
      prisma.db.payment.findUniqueOrThrow({ where: { id: payment.id } }),
    );
    expect(fresh.settledAt).toBeNull();
  }, 20_000);

  it('Expense PENDING: reconciliar lo marca PAID y desconciliar lo vuelve PENDING', async () => {
    const expense = await runWithTenant(ctx(clubId), async () =>
      prisma.db.expense.create({
        data: {
          clubId, code: `EXP-${randomUUID().slice(0, 8)}`, concept: 'Alquiler',
          amount: 8_000, total: 8_000, date: new Date(), status: 'PENDING',
        },
      }),
    );
    const bankTx = await makeBankTx(-8_000, 'Débito alquiler');

    await runWithTenant(ctx(clubId), async () =>
      treasury.reconcile(bankTx.id, { kind: 'EXPENSE', id: expense.id }, clubId, userId),
    );

    let fresh = await runWithTenant(ctx(clubId), async () =>
      prisma.db.expense.findUniqueOrThrow({ where: { id: expense.id } }),
    );
    expect(fresh.status).toBe('PAID');
    expect(fresh.paidAt).not.toBeNull();

    // Antes de la corrección: esto no hacía NADA sobre el Expense (el
    // `updateMany` buscaba el id entre los Payment, no lo encontraba, y
    // el gasto quedaba PAID para siempre).
    await runWithTenant(ctx(clubId), async () =>
      treasury.unreconcile(bankTx.id, clubId, userId),
    );

    fresh = await runWithTenant(ctx(clubId), async () =>
      prisma.db.expense.findUniqueOrThrow({ where: { id: expense.id } }),
    );
    expect(fresh.status).toBe('PENDING');
    expect(fresh.paidAt).toBeNull();
  }, 20_000);

  it('Expense ya PAID (por caja) antes de conciliar: desconciliar NO lo despaga', async () => {
    const expense = await runWithTenant(ctx(clubId), async () =>
      prisma.db.expense.create({
        data: {
          clubId, code: `EXP-${randomUUID().slice(0, 8)}`, concept: 'Insumos buffet',
          amount: 3_000, total: 3_000, date: new Date(),
          status: 'PAID', paidAt: new Date(Date.now() - 86_400_000),
        },
      }),
    );
    const bankTx = await makeBankTx(-3_000, 'Débito insumos (ya pagado por caja)');

    await runWithTenant(ctx(clubId), async () =>
      treasury.reconcile(bankTx.id, { kind: 'EXPENSE', id: expense.id }, clubId, userId),
    );

    await runWithTenant(ctx(clubId), async () =>
      treasury.unreconcile(bankTx.id, clubId, userId),
    );

    const fresh = await runWithTenant(ctx(clubId), async () =>
      prisma.db.expense.findUniqueOrThrow({ where: { id: expense.id } }),
    );
    // Seguía pagado antes de conciliar este movimiento: desconciliar solo
    // desvincula el movimiento bancario, no revierte un pago que ya existía.
    expect(fresh.status).toBe('PAID');
  }, 20_000);

  it('un gasto no puede conciliarse contra dos movimientos bancarios distintos', async () => {
    const expense = await runWithTenant(ctx(clubId), async () =>
      prisma.db.expense.create({
        data: {
          clubId, code: `EXP-${randomUUID().slice(0, 8)}`, concept: 'Mantenimiento',
          amount: 4_000, total: 4_000, date: new Date(), status: 'PENDING',
        },
      }),
    );
    const bankTxA = await makeBankTx(-4_000, 'Débito mantenimiento A');
    const bankTxB = await makeBankTx(-4_000, 'Débito mantenimiento B');

    await runWithTenant(ctx(clubId), async () =>
      treasury.reconcile(bankTxA.id, { kind: 'EXPENSE', id: expense.id }, clubId, userId),
    );

    // Mismo gasto, OTRO movimiento bancario: antes se aceptaba sin avisar
    // (doble imputación de una sola obligación real).
    await expect(
      runWithTenant(ctx(clubId), async () =>
        treasury.reconcile(bankTxB.id, { kind: 'EXPENSE', id: expense.id }, clubId, userId),
      ),
    ).rejects.toThrow('ya fue conciliado');
  }, 20_000);
});
