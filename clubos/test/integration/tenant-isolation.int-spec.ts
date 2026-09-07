/**
 * Test de AISLAMIENTO MULTI-TENANT.
 *
 * Es el test más importante de un SaaS: verifica que un club NUNCA pueda ver
 * datos de otro. No es solo correctitud — es un argumento de venta ("tus datos
 * están aislados a nivel base de datos") y una garantía legal.
 *
 * Prueba la RLS de verdad, contra Postgres: crea dos clubes, inserta datos en
 * cada uno, y verifica que consultando bajo el contexto del club A no aparece
 * NADA del club B, y viceversa.
 *
 * Requiere una base de test. Se SALTA (no falla) si no hay DATABASE_URL_TEST,
 * para que la suite unit corra sin infraestructura.
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  runWithTenant,
  runWithoutTenancy,
} from '../../src/tenancy/tenant-context';
import { randomUUID } from 'node:crypto';

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

d('Aislamiento multi-tenant (RLS)', () => {
  let prisma: PrismaService;
  let clubA: string;
  let clubB: string;
  let planId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    prisma = new PrismaService();
    await prisma.onModuleInit();

    // Setup de plataforma (sin tenant): plan + dos clubes.
    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan' },
        update: {},
        create: {
          code: 'test-plan', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });
      planId = plan.id;

      const a = await prisma.club.create({
        data: { slug: `test-a-${Date.now()}`, name: 'Club A', planId, status: 'ACTIVE' },
      });
      const b = await prisma.club.create({
        data: { slug: `test-b-${Date.now()}`, name: 'Club B', planId, status: 'ACTIVE' },
      });
      clubA = a.id;
      clubB = b.id;
    });

    // Un cliente en cada club (Client tiene RLS).
    await runWithTenant(ctx(clubA), () =>
      prisma.db.client.create({
        data: { clubId: clubA, firstName: 'Ana', lastName: 'DelClubA' },
      }),
    );
    await runWithTenant(ctx(clubB), () =>
      prisma.db.client.create({
        data: { clubId: clubB, firstName: 'Beto', lastName: 'DelClubB' },
      }),
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    await runWithoutTenancy(randomUUID(), async () => {
      await prisma.club.deleteMany({ where: { id: { in: [clubA, clubB] } } });
    });
    await prisma.onModuleDestroy();
  });

  it('el club A solo ve sus propios clientes', async () => {
    const clients = await runWithTenant(ctx(clubA), () =>
      prisma.db.client.findMany({ select: { firstName: true, clubId: true } }),
    );
    expect(clients.length).toBeGreaterThan(0);
    expect(clients.every((c) => c.clubId === clubA)).toBe(true);
    expect(clients.some((c) => c.firstName === 'Beto')).toBe(false);
  });

  it('el club B solo ve sus propios clientes', async () => {
    const clients = await runWithTenant(ctx(clubB), () =>
      prisma.db.client.findMany({ select: { firstName: true, clubId: true } }),
    );
    expect(clients.every((c) => c.clubId === clubB)).toBe(true);
    expect(clients.some((c) => c.firstName === 'Ana')).toBe(false);
  });

  it('el club A no puede leer un cliente del club B ni por id directo', async () => {
    const betoDelB = await runWithTenant(ctx(clubB), () =>
      prisma.db.client.findFirst({ where: { firstName: 'Beto' }, select: { id: true } }),
    );
    expect(betoDelB).not.toBeNull();

    // Intentar leerlo desde el contexto del club A: la RLS lo oculta.
    const leak = await runWithTenant(ctx(clubA), () =>
      prisma.db.client.findUnique({ where: { id: betoDelB!.id } }),
    );
    expect(leak).toBeNull();
  });

  it('sin contexto de club, el acceso a un modelo tenant falla ruidosamente', async () => {
    await expect(
      prisma.db.client.findMany(),
    ).rejects.toThrow();
  });
});
