/**
 * Test de CONCURRENCIA en caja.
 *
 * `addMovement` rechaza un retiro que dejaría la caja en negativo, pero ese
 * chequeo lee el saldo ANTES de escribir. Sin un lock, dos retiros
 * concurrentes pueden leer el mismo saldo "disponible" y ambos pasan el
 * chequeo — el clásico TOCTOU. Este test dispara dos retiros en paralelo por
 * más de lo que hay en la caja y verifica que exactamente uno sobrevive.
 *
 * Requiere una base de test. Se SALTA (no falla) si no hay DATABASE_URL_TEST,
 * igual que tenant-isolation.int-spec.ts.
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CashService } from '../../src/cash/services/cash.service';
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
    permissions: new Set<Permission>(),
    isPlatformAdmin: false,
    requestId: randomUUID(),
    bypassTenancy: false,
  };
}

d('Concurrencia de caja', () => {
  let prisma: PrismaService;
  let cash: CashService;
  let clubId: string;
  let membershipId: string;
  let userId: string;
  let registerId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    cash = new CashService(prisma);

    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan-cash' },
        update: {},
        create: {
          code: 'test-plan-cash', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });
      const club = await prisma.club.create({
        data: { slug: `test-cash-${Date.now()}`, name: 'Club Cash Test', planId: plan.id, status: 'ACTIVE' },
      });
      clubId = club.id;

      const user = await prisma.user.create({
        data: {
          email: `cash-test-${Date.now()}@test.com`,
          passwordHash: await bcrypt.hash('Password1234', 4),
          firstName: 'Cash', lastName: 'Tester',
        },
      });
      userId = user.id;
    });

    await runWithTenant(ctx(clubId), async () => {
      const role = await prisma.db.role.create({
        data: {
          clubId, code: 'OWNER', name: 'Dueño',
          permissions: [PERMISSIONS.CASH_MOVEMENT, PERMISSIONS.CASH_CLOSE],
          isSystem: true,
        },
      });
      const membership = await prisma.db.membership.create({
        data: { clubId, userId, roleId: role.id, status: 'ACTIVE' },
      });
      membershipId = membership.id;

      const register = await prisma.db.cashRegister.create({
        data: { clubId, name: 'Recepción Test' },
      });
      registerId = register.id;
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    // No se puede hacer un DELETE en cascada: abrir/cerrar caja escribe en
    // audit_logs, que es append-only (trigger de Postgres lo rechaza a
    // propósito). Es una base de test descartable — se deja el club creado.
    await prisma.onModuleDestroy();
  });

  it('no permite que dos retiros concurrentes dejen la caja en negativo', async () => {
    const sessionId = await runWithTenant(ctx(clubId), async () => {
      const session = await cash.open(
        { registerId, openingAmount: 1000 } as never,
        clubId,
        membershipId,
      );
      return session.id;
    });

    // $1000 en caja. 5 retiros de $600 en paralelo: juntos exceden por mucho
    // lo disponible, así que como máximo UNO puede tener éxito. Con solo 2
    // intentos la ventana de la carrera es demasiado angosta para
    // reproducirse de forma confiable (dos SELECT sin lock en un Postgres
    // local responden en submilisegundos); con 5 se fuerza el solapamiento.
    const attempt = () =>
      runWithTenant(ctx(clubId), async () =>
        cash.addMovement(
          sessionId,
          { type: 'WITHDRAWAL', amount: 600, concept: 'Retiro concurrente' } as never,
          clubId,
          userId,
        ),
      );

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => attempt()),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(4);

    // El saldo final tiene que reflejar UN SOLO retiro, no dos.
    const balance = await runWithTenant(ctx(clubId), async () =>
      cash.getBalance(sessionId),
    );
    expect(balance.expectedCash).toBe(400);
  }, 20_000);
});
