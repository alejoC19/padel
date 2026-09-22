/**
 * Test de CONCURRENCIA en el pago de gastos.
 *
 * `payExpense` leía el status del gasto, chequeaba que no estuviera PAID/
 * CANCELLED, y solo AL FINAL de la transacción lo marcaba PAID. Bajo
 * ReadCommitted (el nivel de `tenantTransaction`), dos pagos concurrentes del
 * MISMO gasto pasan ambos ese chequeo inicial — ninguno vio todavía el UPDATE
 * del otro — y los dos terminan moviendo plata: dos decrementos de banco, dos
 * decrementos de saldo de proveedor, para una sola obligación. Mismo patrón
 * de bug (y mismo test) que cash-concurrency.int-spec.ts para retiros de caja.
 *
 * El fix reclama el gasto con un `updateMany` atómico (status en el WHERE)
 * ANTES de tocar banco/proveedor: solo uno de los dos pagos concurrentes
 * puede ganar esa carrera.
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ExpenseService } from '../../src/treasury/services/expense.service';
import { DocumentNumberService } from '../../src/bookings/services/document-number.service';
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

d('Concurrencia en pago de gastos', () => {
  let prisma: PrismaService;
  let expenses: ExpenseService;
  let clubId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    expenses = new ExpenseService(prisma, new DocumentNumberService());

    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan-expense' },
        update: {},
        create: {
          code: 'test-plan-expense', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });
      const club = await prisma.club.create({
        data: { slug: `test-expense-${Date.now()}`, name: 'Club Expense Test', planId: plan.id, status: 'ACTIVE' },
      });
      clubId = club.id;
    });

    await runWithTenant(ctx(clubId), async () => {
      const account = await prisma.db.bankAccount.create({
        data: { clubId, bankName: 'Banco Test', accountName: 'Cuenta Test', currentBalance: 100_000 },
      });
      bankAccountId = account.id;
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await runWithoutTenancy(randomUUID(), async () => {
      await prisma.club.deleteMany({ where: { id: clubId } });
    });
    await prisma.onModuleDestroy();
  });

  it('no permite que dos pagos concurrentes paguen el mismo gasto dos veces', async () => {
    const expenseId = await runWithTenant(ctx(clubId), async () => {
      const { id } = await expenses.registerExpense({
        clubId, concept: 'Factura de luz', amount: 10_000, date: '2026-01-01',
      });
      return id;
    });

    const attempt = () =>
      runWithTenant(ctx(clubId), async () =>
        expenses.payExpense(expenseId, { clubId, bankAccountId }),
      );

    // 5 intentos concurrentes de pagar EL MISMO gasto: como máximo uno puede
    // ganar la carrera contra el `updateMany` atómico.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => attempt()),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(4);

    // El banco tiene que haber bajado UNA sola vez, no cinco.
    const account = await runWithTenant(ctx(clubId), async () =>
      prisma.db.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } }),
    );
    expect(Number(account.currentBalance)).toBe(90_000);
  }, 20_000);

  it('rechaza pagar un gasto con medio de pago Y cuenta bancaria a la vez', async () => {
    const expenseId = await runWithTenant(ctx(clubId), async () => {
      const { id } = await expenses.registerExpense({
        clubId, concept: 'Gasto XOR', amount: 5_000, date: '2026-01-01',
      });
      return id;
    });

    const balanceBefore = await runWithTenant(ctx(clubId), async () =>
      prisma.db.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } }),
    );

    await expect(
      runWithTenant(ctx(clubId), async () =>
        expenses.payExpense(expenseId, {
          clubId,
          paymentMethodId: randomUUID(),
          bankAccountId,
        }),
      ),
    ).rejects.toThrow(/un solo medio de pago/i);

    // No debe haber tocado el banco: la validación corta antes de mover nada.
    const balanceAfter = await runWithTenant(ctx(clubId), async () =>
      prisma.db.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } }),
    );
    expect(Number(balanceAfter.currentBalance)).toBe(Number(balanceBefore.currentBalance));

    // El gasto sigue pendiente, no quedó marcado PAID a mitad de camino.
    const expense = await runWithTenant(ctx(clubId), async () =>
      prisma.db.expense.findUniqueOrThrow({ where: { id: expenseId } }),
    );
    expect(expense.status).toBe('PENDING');
  });
});
