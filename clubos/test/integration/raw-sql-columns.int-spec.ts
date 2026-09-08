/**
 * Test de que las queries `$queryRaw`/`tenantQueryRaw` referencian columnas
 * que EXISTEN de verdad.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTE TEST, Y POR QUÉ NO LO CUBRÍAN LOS OTROS 300+
 * ---------------------------------------------------------------------------
 * `verify` (171), `smoke-test.mjs` (115) y `e2e-day.mjs` (19) le pegan
 * directo a Postgres con SQL propio para probar constraints/RLS/triggers —
 * ninguno llama al código real de `reports/`, `treasury/` ni `pos/`. Por
 * eso seis queries con nombres de columna mal escritos (snake_case donde el
 * schema es camelCase, o directamente el nombre equivocado — `methodId` en
 * vez de `paymentMethodId`) llegaron hasta acá sin que nada las corriera:
 * `daily-close.service.ts` (oh.day_of_week), `cash-flow.service.ts`
 * (current_balance, is_active, m.methodId, m.sessionId),
 * `profitability.service.ts` y `expense.service.ts` (p/e.categoryId sin
 * comillas), `stock.service.ts` (stock_qty, min_stock_qty, is_active,
 * track_stock, cost_price, sale_price) y `client.service.ts` (club_id,
 * deleted_at, birth_date en el filtro de cumpleaños). Ninguna se detectaba
 * hasta ejecutar el endpoint real — TypeScript no valida SQL crudo.
 *
 * Este test no reimplementa la lógica: llama a los servicios reales dentro
 * de un club de prueba y solo verifica que la query no explote con
 * "column X does not exist" — la prueba mínima de que el SQL es válido.
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ClubConfigService } from '../../src/bookings/services/club-config.service';
import { DailyCloseService } from '../../src/reports/services/daily-close.service';
import { ProfitabilityService } from '../../src/reports/services/profitability.service';
import { CashFlowService } from '../../src/treasury/services/cash-flow.service';
import { ExpenseService } from '../../src/treasury/services/expense.service';
import { DocumentNumberService } from '../../src/bookings/services/document-number.service';
import { StockService } from '../../src/pos/services/stock.service';
import { ClientService } from '../../src/clients/services/client.service';
import { ClientSearchService } from '../../src/clients/services/client-search.service';
import { PlanLimitsService } from '../../src/common/services/plan-limits.service';
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

d('Columnas reales en SQL crudo (reports/treasury/pos/clients)', () => {
  let prisma: PrismaService;
  let clubId: string;
  const today = new Date().toISOString().slice(0, 10);

  const config = () => new ClubConfigService(prisma);
  const dailyClose = () => new DailyCloseService(prisma, config());
  const profitability = () => new ProfitabilityService(prisma, config());
  const cashFlow = () => new CashFlowService(prisma);
  const expenses = () => new ExpenseService(prisma, new DocumentNumberService());
  const stock = () => new StockService(prisma);
  const clients = () =>
    new ClientService(prisma, new ClientSearchService(prisma), new PlanLimitsService(prisma));

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    prisma = new PrismaService();
    await prisma.onModuleInit();

    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan-rawsql' },
        update: {},
        create: {
          code: 'test-plan-rawsql', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });
      const club = await prisma.club.create({
        data: { slug: `test-rawsql-${Date.now()}`, name: 'Club RawSQL Test', planId: plan.id, status: 'ACTIVE' },
      });
      clubId = club.id;
    });

    await runWithTenant(ctx(clubId), async () => {
      const sport = await prisma.db.sport.create({ data: { clubId, code: 'PADEL', name: 'Pádel' } });
      await prisma.db.court.create({
        data: { clubId, sportId: sport.id, name: 'Cancha 1', number: 1, status: 'AVAILABLE' },
      });
      await prisma.db.client.create({
        data: { clubId, firstName: 'Cliente', lastName: 'Test', phone: '+5491100003333' },
      });
      await prisma.db.product.create({
        data: {
          clubId, sku: 'RAWSQL-1', name: 'Producto Test', kind: 'GOOD',
          costPrice: 100, salePrice: 200, stockQty: 5, minStockQty: 2,
        },
      });
      await prisma.db.bankAccount.create({
        data: { clubId, bankName: 'Test Bank', accountName: 'Cuenta Test', currentBalance: 1000 },
      });
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.onModuleDestroy();
  });

  it('DailyCloseService.getDailyClose no explota (oh."dayOfWeek")', async () => {
    const result = await runWithTenant(ctx(clubId), async () =>
      dailyClose().getDailyClose(today, clubId),
    );
    expect(typeof result.bookings.occupancyPercent).toBe('number');
  });

  it('ProfitabilityService.getProductProfitability no explota (p."categoryId")', async () => {
    const result = await runWithTenant(ctx(clubId), async () =>
      profitability().getProductProfitability(today, today, clubId),
    );
    expect(Array.isArray(result.products)).toBe(true);
  });

  it('CashFlowService.project no explota ("currentBalance", "isActive", "paymentMethodId", "sessionId")', async () => {
    const result = await runWithTenant(ctx(clubId), async () => cashFlow().project(7));
    expect(typeof result.openingBalance).toBe('number');
  });

  it('ExpenseService.listPending / getByCategory no explotan (e."categoryId")', async () => {
    const pending = await runWithTenant(ctx(clubId), async () => expenses().listPending());
    expect(Array.isArray(pending)).toBe(true);

    const byCategory = await runWithTenant(ctx(clubId), async () =>
      expenses().getByCategory(today, today),
    );
    expect(typeof byCategory.total).toBe('number');
  });

  it('StockService.getAlerts / getInventoryValue no explotan ("stockQty", "minStockQty", "isActive", "trackStock", "costPrice", "salePrice")', async () => {
    const alerts = await runWithTenant(ctx(clubId), async () => stock().getAlerts());
    expect(Array.isArray(alerts)).toBe(true);

    const value = await runWithTenant(ctx(clubId), async () => stock().getInventoryValue());
    expect(typeof value.costValue).toBe('number');
  });

  it('ClientService.list con birthdayMonth no explota ("clubId", "deletedAt", "birthDate")', async () => {
    const result = await runWithTenant(ctx(clubId), async () =>
      clients().list({ birthdayMonth: 9 } as Parameters<ClientService['list']>[0]),
    );
    expect(Array.isArray(result.items)).toBe(true);
  });
});
