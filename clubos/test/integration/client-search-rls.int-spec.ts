/**
 * Regresión: la búsqueda de clientes (y la detección de duplicados al dar
 * de alta) usaba `prisma.db.$queryRawUnsafe`, que NO pasa por el
 * interceptor que hace `SET LOCAL app.current_club_id` — las raw queries
 * se saltan ese wrapper a propósito (ver PrismaService, sección "raw
 * queries: paso directo"). Con el rol restringido `clubos_app` sujeto a
 * RLS FORCE, eso significa que la política de fila bloqueaba TODO,
 * aunque el propio SQL ya filtrara `WHERE "clubId" = $1`: sin el
 * contexto seteado en la conexión, `search()` devolvía siempre `[]`, para
 * cualquier término, incluso una coincidencia exacta.
 *
 * El fix fue cambiar esos call sites a `prisma.tenantQueryRaw(...)` (el
 * helper que ya existía para exactamente este caso, pero nadie llamaba).
 * Este test corre contra Postgres de verdad (no se puede reproducir el
 * bug con un mock: el problema vive en la política RLS, no en el SQL).
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import { ClientSearchService } from '../../src/clients/services/client-search.service';
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

d('ClientSearchService — búsqueda bajo RLS', () => {
  let prisma: PrismaService;
  let search: ClientSearchService;
  let clubId: string;
  let planId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    search = new ClientSearchService(prisma);

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

      const club = await prisma.club.create({
        data: { slug: `test-search-${Date.now()}`, name: 'Club Search', planId, status: 'ACTIVE' },
      });
      clubId = club.id;
    });

    await runWithTenant(ctx(clubId), async () => {
      await prisma.db.client.create({
        data: {
          clubId, firstName: 'José', lastName: 'González', phone: '11 5678-9011',
        },
      });
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await runWithoutTenancy(randomUUID(), async () => {
      await prisma.club.deleteMany({ where: { id: clubId } });
    });
    await prisma.onModuleDestroy();
  });

  it('encuentra por subcadena del apellido, sin acentos', async () => {
    const results = await runWithTenant(ctx(clubId), async () =>
      search.search('gonz', clubId),
    );
    expect(results.some((r) => r.lastName === 'González')).toBe(true);
  });

  it('encuentra por nombre exacto', async () => {
    const results = await runWithTenant(ctx(clubId), async () =>
      search.search('José', clubId),
    );
    expect(results.some((r) => r.firstName === 'José')).toBe(true);
  });

  it('findPotentialDuplicates detecta por teléfono', async () => {
    // Mismo número que el cliente creado en beforeAll ("11 5678-9011"),
    // con otro formato — solo importan los últimos 8 dígitos.
    const dups = await runWithTenant(ctx(clubId), async () =>
      search.findPotentialDuplicates(
        { firstName: 'Jose', lastName: 'Gonzalez', phone: '+54 11 5678-9011' },
        clubId,
      ),
    );
    expect(dups.some((d) => d.matchedOn === 'teléfono')).toBe(true);
  });
});
