/**
 * Test de que el contexto de tenant no se pierde ni se cruza entre requests
 * concurrentes — HTTP real, contra la app completa (AppModule), no un
 * servicio aislado.
 *
 * ---------------------------------------------------------------------------
 * QUÉ BUG PRUEBA ESTO
 * ---------------------------------------------------------------------------
 * `TenantGuard` montaba el contexto con `tenantStorage.enterWith()`. Ese
 * método no abre un scope propio: pisa el store "actual" de la cadena de
 * continuaciones async en curso. Bajo tráfico concurrente real (cualquier
 * pantalla del panel dispara varios fetches al cargar), dos requests
 * distintas pueden pisarse: el síntoma reportado en vivo fue
 * "TenantContext no disponible" (500) en un tercio o más de las requests
 * concurrentes — reproducido acá mismo antes de este fix: 73 de 120
 * requests (61%) fallaban.
 *
 * El fix reemplaza `enterWith()` por `TenantContextInterceptor`, que envuelve
 * `next.handle()` (el resto del pipeline) en `tenantStorage.run()` — un
 * scope real, aislado por cadena de continuaciones, que no depende de que
 * ninguna otra request concurrente "no pise" al mismo tiempo.
 *
 * Este test dispara N requests concurrentes alternando entre DOS clubes
 * reales y verifica dos cosas sobre la app real (HTTP, guards e
 * interceptor incluidos, no una reimplementación):
 *   1. Ninguna cae con 500 "TenantContext no disponible".
 *   2. Ninguna ve datos del OTRO club — la prueba real de aislamiento
 *      bajo concurrencia, no solo "no explota".
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { runWithoutTenancy, runWithTenant } from '../../src/tenancy/tenant-context';
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

d('Contexto de tenant bajo requests HTTP concurrentes', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenA: string;
  let tokenB: string;
  let baseUrl: string;
  const markerA = `SOLO_A_${randomUUID().slice(0, 8)}`;
  const markerB = `SOLO_B_${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    process.env.JWT_ACCESS_SECRET ??= 'test-secret-concurrency';
    process.env.PAYMENTS_ENC_KEY ??= 'clave-de-test-de-al-menos-treinta-y-dos-chars';

    // NOTA: `overrideGuard(ThrottlerGuard)` NO tiene efecto acá — Throttler
    // está registrado junto a JwtAuthGuard/TenantGuard/PermissionsGuard como
    // varios `{ provide: APP_GUARD, useClass: ... }` sobre el mismo token, y
    // el mecanismo de override de Nest no lo intercepta en ese caso (se
    // comprobó en vivo: con el override puesto, exactamente 10 de 100
    // requests pasaban — el límite real de `short`, no el override). En vez
    // de pelear contra eso, el test dispara en LOTES de a 8 (bajo el límite
    // real de 10/1000ms) con una pausa entre lotes — cada lote sigue siendo
    // concurrencia real dentro de sí mismo, que es lo que hace falta para
    // exponer la race de `enterWith()`: la reproducción manual (fuera de
    // Jest, contra un server real) encontró 73/120 fallas con el código
    // viejo usando este mismo patrón de lotes de 8.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Replica lo que hace bootstrap() en main.ts — el prefijo global y el
    // ValidationPipe no viven en AppModule, así que sin esto /auth/login
    // ni siquiera resuelve la ruta.
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'metrics'] });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${typeof address === 'string' ? address : address!.port}`;

    prisma = moduleRef.get(PrismaService);

    // Dos clubes reales, cada uno con un cliente marcador único.
    let clubIdA: string;
    let clubIdB: string;
    let userIdA: string;
    let userIdB: string;

    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan-concur-http' },
        update: {},
        create: {
          code: 'test-plan-concur-http', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash('Concur1234!', 10);

      const clubA = await prisma.club.create({
        data: { slug: `test-concur-a-${Date.now()}`, name: 'Concur A', planId: plan.id, status: 'ACTIVE' },
      });
      const clubB = await prisma.club.create({
        data: { slug: `test-concur-b-${Date.now()}`, name: 'Concur B', planId: plan.id, status: 'ACTIVE' },
      });
      clubIdA = clubA.id;
      clubIdB = clubB.id;

      const roleOwnerA = await prisma.db.role.create({
        data: {
          clubId: clubIdA, code: 'OWNER', name: 'Owner',
          permissions: Object.values(PERMISSIONS) as string[],
        },
      });
      const roleOwnerB = await prisma.db.role.create({
        data: {
          clubId: clubIdB, code: 'OWNER', name: 'Owner',
          permissions: Object.values(PERMISSIONS) as string[],
        },
      });

      const userA = await prisma.user.create({
        data: { email: `concur-a-${Date.now()}@test.com`, passwordHash, firstName: 'A', lastName: 'Owner' },
      });
      const userB = await prisma.user.create({
        data: { email: `concur-b-${Date.now()}@test.com`, passwordHash, firstName: 'B', lastName: 'Owner' },
      });
      userIdA = userA.id;
      userIdB = userB.id;

      await prisma.db.membership.create({
        data: { clubId: clubIdA, userId: userIdA, roleId: roleOwnerA.id, status: 'ACTIVE' },
      });
      await prisma.db.membership.create({
        data: { clubId: clubIdB, userId: userIdB, roleId: roleOwnerB.id, status: 'ACTIVE' },
      });
    });

    await runWithTenant(ctx(clubIdA!), async () => {
      await prisma.db.client.create({
        data: { clubId: clubIdA, firstName: markerA, lastName: 'Test', phone: '+5491100001111' },
      });
    });
    await runWithTenant(ctx(clubIdB!), async () => {
      await prisma.db.client.create({
        data: { clubId: clubIdB, firstName: markerB, lastName: 'Test', phone: '+5492200002222' },
      });
    });

    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: (await prisma.user.findUniqueOrThrow({ where: { id: userIdA! } })).email, password: 'Concur1234!' });
    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: (await prisma.user.findUniqueOrThrow({ where: { id: userIdB! } })).email, password: 'Concur1234!' });

    if (!loginA.body.accessToken) console.error('loginA failed:', loginA.status, loginA.body);
    if (!loginB.body.accessToken) console.error('loginB failed:', loginB.status, loginB.body);
    tokenA = loginA.body.accessToken;
    tokenB = loginB.body.accessToken;
    expect(tokenA).toEqual(expect.any(String));
    expect(tokenB).toEqual(expect.any(String));
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.onModuleDestroy();
  });

  it('96 requests concurrentes (en lotes) alternando entre dos clubes: sin 500 y sin cruce de datos', async () => {
    // El Throttler real sigue activo (ver nota arriba sobre por qué
    // overrideGuard no lo desactiva acá) con límite `short` de 10/1000ms
    // compartido por IP entre ambos tokens. Se dispara en lotes de 8 —
    // concurrencia real dentro de cada lote, que es lo que hace falta para
    // exponer la race — con una pausa entre lotes para no pisar el límite.
    const BATCH_SIZE = 8;
    const BATCHES = 12;
    const TOTAL = BATCH_SIZE * BATCHES;
    type Result = { useA: boolean; status: number; body: unknown };
    const results: Result[] = [];
    const rejections: unknown[] = [];

    let seq = 0;
    for (let b = 0; b < BATCHES; b++) {
      const settled = await Promise.allSettled(
        Array.from({ length: BATCH_SIZE }, () => {
          const useA = seq++ % 2 === 0;
          return fetch(`${baseUrl}/api/v1/clients`, {
            headers: { Authorization: `Bearer ${useA ? tokenA : tokenB}` },
          }).then(async (res) => ({ useA, status: res.status, body: await res.json() }));
        }),
      );
      for (const s of settled) {
        if (s.status === 'fulfilled') results.push(s.value);
        else rejections.push(s.reason);
      }
      if (b < BATCHES - 1) await new Promise((r) => setTimeout(r, 1100));
    }

    for (const reason of rejections) console.error('REQUEST REJECTED:', reason);

    let serverErrors = 0;
    let rateLimited = 0;
    let leaks = 0;
    let correct = 0;

    for (const { useA, status, body } of results) {
      if (status >= 500) {
        serverErrors++;
        continue;
      }
      if (status === 429) {
        rateLimited++;
        continue;
      }
      if (status !== 200) continue;
      const items = (body as { items?: { firstName: string }[] }).items ?? [];
      const names: string[] = items.map((c) => c.firstName);
      const ownMarker = useA ? markerA : markerB;
      const foreignMarker = useA ? markerB : markerA;
      if (names.includes(foreignMarker)) leaks++;
      if (names.includes(ownMarker)) correct++;
    }

    expect(rejections.length).toBe(0);
    expect(serverErrors).toBe(0);
    expect(leaks).toBe(0);
    // Los lotes están por debajo del límite real del throttler, así que
    // ninguna debería rebotar con 429 — si esto no da 0, el test ya no está
    // respetando el límite real y hay que revisar BATCH_SIZE/la pausa.
    expect(rateLimited).toBe(0);
    expect(correct).toBe(TOTAL);
  }, 60_000);
});
