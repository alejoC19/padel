/**
 * Test de que crear/cancelar una reserva encola el aviso al cliente.
 *
 * El README de `notifications` documentaba esto como "pendiente de cablear":
 * el gancho existía (`NotificationsService.enqueueBookingConfirmed/
 * Cancelled`) pero nada en `BookingService.create()`/`cancel()` lo llamaba
 * — ni las reservas de mostrador ni las del portal público (que reusan el
 * mismo `create()`) avisaban nada al cliente salvo que pagaran online vía
 * Mercado Pago. Este test prueba el servicio real, no una reimplementación:
 * si alguien saca el enqueue de `create()`/`cancel()`, esto falla.
 *
 *   DATABASE_URL_TEST=postgresql://... npm run test:int
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { BookingsModule } from '../../src/bookings/bookings.module';
import { BookingService } from '../../src/bookings/services/booking.service';
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

d('Avisos de reserva (confirmación / cancelación)', () => {
  let prisma: PrismaService;
  let bookings: BookingService;
  let clubId: string;
  let courtId: string;
  let clientId: string;
  let ownerId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, BookingsModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    bookings = moduleRef.get(BookingService);

    await runWithoutTenancy(randomUUID(), async () => {
      const plan = await prisma.plan.upsert({
        where: { code: 'test-plan-notif' },
        update: {},
        create: {
          code: 'test-plan-notif', name: 'Test', priceMonthly: 0, priceYearly: 0,
          maxCourts: 10, maxUsers: 10, maxClients: 1000,
        },
      });

      const club = await prisma.club.create({
        data: { slug: `test-notif-${Date.now()}`, name: 'Club Notif Test', planId: plan.id, status: 'ACTIVE' },
      });
      clubId = club.id;

      const owner = await prisma.user.create({
        data: { email: `owner-notif-${Date.now()}@test.com`, passwordHash: 'x', firstName: 'O', lastName: 'W' },
      });
      ownerId = owner.id;
    });

    await runWithTenant(ctx(clubId), async () => {
      const sport = await prisma.db.sport.create({
        data: { clubId, code: 'PADEL', name: 'Pádel' },
      });
      const court = await prisma.db.court.create({
        data: { clubId, sportId: sport.id, name: 'Cancha 1', number: 1, status: 'AVAILABLE' },
      });
      courtId = court.id;

      const client = await prisma.db.client.create({
        data: {
          clubId,
          firstName: 'Cliente',
          lastName: 'Test',
          phone: '+5491100001111',
        },
      });
      clientId = client.id;
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.onModuleDestroy();
  });

  it('crear una reserva encola BOOKING_CONFIRMED para el cliente', async () => {
    const result = await runWithTenant(ctx(clubId), async () =>
      bookings.create(
        {
          courtId,
          startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          durationMinutes: 60,
          clientId,
          overridePrice: 10_000,
          allowOutsideHours: true,
        } as Parameters<BookingService['create']>[0],
        clubId,
        ownerId,
      ),
    );

    const rows = await runWithTenant(ctx(clubId), async () =>
      prisma.db.notification.findMany({
        where: { clubId, clientId, type: 'BOOKING_CONFIRMED' },
      }),
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].channel).toBe('WHATSAPP');

    (globalThis as { __bookingId?: string }).__bookingId = result.id;
  }, 20_000);

  it('cancelar la reserva encola BOOKING_CANCELLED para el cliente', async () => {
    const bookingId = (globalThis as { __bookingId?: string }).__bookingId!;

    await runWithTenant(ctx(clubId), async () =>
      bookings.cancel(
        bookingId,
        { cancelledBy: 'CLIENT', reason: 'Test' } as Parameters<BookingService['cancel']>[1],
        clubId,
        ownerId,
      ),
    );

    const rows = await runWithTenant(ctx(clubId), async () =>
      prisma.db.notification.findMany({
        where: { clubId, clientId, type: 'BOOKING_CANCELLED' },
      }),
    );

    expect(rows.length).toBeGreaterThan(0);
  }, 20_000);
});
