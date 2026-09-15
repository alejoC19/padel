/**
 * El descuento global de una venta del buffet tiene que restarse ANTES de
 * calcular el impuesto, no después.
 *
 * El precio de lista es final (IVA incluido) y el impuesto se extrae del
 * total ya descontado — pero el descuento GLOBAL del ticket (a diferencia
 * del descuento por línea) se sumaba recién después de haber calculado el
 * impuesto de cada línea sobre el precio SIN ese descuento. Con IVA 21% y un
 * descuento global que deja la venta en $900, el impuesto correcto sobre
 * esos $900 es $156.20, no los $173.55 que salían de calcularlo sobre los
 * $1.000 de lista — impuesto de más sobre plata que el cliente nunca pagó.
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PosModule } from '../../src/pos/pos.module';
import { PosService } from '../../src/pos/services/pos.service';
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

d('POS: el descuento global se aplica antes de extraer el impuesto', () => {
  let prisma: PrismaService;
  let pos: PosService;
  let clubId: string;
  let userId: string;
  let productId: string;
  let methodId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, PosModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    pos = moduleRef.get(PosService);

    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan-pos-tax' },
        update: {},
        create: {
          code: 'test-plan-pos-tax', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });
      const club = await prisma.club.create({
        data: { slug: `test-pos-tax-${Date.now()}`, name: 'Club POS Tax', planId: plan.id, status: 'ACTIVE' },
      });
      clubId = club.id;

      const user = await prisma.user.create({
        data: {
          email: `pos-tax-${randomUUID()}@example.com`,
          passwordHash: 'x', firstName: 'Test', lastName: 'User',
        },
      });
      userId = user.id;
    });

    await runWithTenant(ctx(clubId), async () => {
      const product = await prisma.db.product.create({
        data: {
          clubId, name: 'Paleta alquiler', kind: 'RENTAL',
          salePrice: 1_000, costPrice: 0, taxRate: 21, trackStock: false, unit: 'UNIDAD',
        },
      });
      productId = product.id;

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

  it('un descuento global de $100 sobre $1.000 (IVA 21%) reduce el impuesto proporcionalmente', async () => {
    const result = await runWithTenant(ctx(clubId), async () =>
      pos.createSale(
        {
          items: [{ productId, quantity: 1 }],
          globalDiscount: 100,
          payment: { paymentMethodId: methodId, amount: 900 },
        } as never,
        clubId,
        userId,
      ),
    );

    const sale = await runWithTenant(ctx(clubId), async () =>
      prisma.db.sale.findUniqueOrThrow({ where: { id: result.id } }),
    );

    expect(Number(sale.subtotal)).toBe(1_000);
    expect(Number(sale.discountAmount)).toBe(100);
    expect(Number(sale.total)).toBe(900);
    // 900 - 900/1.21 = 156.198... → 156.20. Antes de la corrección esto daba
    // 173.55 (el IVA de $1.000, ignorando el descuento global).
    expect(Number(sale.taxAmount)).toBeCloseTo(156.2, 1);
  }, 20_000);
});
