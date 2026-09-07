import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithoutTenancy } from '../../tenancy/tenant-context';
import { NotificationsService } from './notifications.service';
import { formatBookingDate, formatBookingTime } from './format.util';

/**
 * Programa los recordatorios de reservas.
 *
 * Cada 15 minutos busca reservas activas que arranquen dentro de las próximas
 * ventanas (~24h y ~2h) y encola el recordatorio, evitando duplicados: si ya
 * existe una notificación BOOKING_REMINDER para esa reserva y esa ventana, no
 * la vuelve a crear.
 *
 * No agrega columnas al schema: el "ya recordé esto" se deduce de la propia
 * tabla Notification (fuente de verdad única).
 */
@Injectable()
export class ReminderScheduler {
  private readonly log = new Logger(ReminderScheduler.name);
  private running = false;

  // Ventanas de recordatorio. Cada una se manda una sola vez por reserva.
  private static readonly WINDOWS = [
    { key: '24h', minutesBefore: 24 * 60, toleranceMin: 15 },
    { key: '2h', minutesBefore: 2 * 60, toleranceMin: 15 },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await runWithoutTenancy(randomUUID(), () => this.schedule());
    } catch (err) {
      this.log.error(`Fallo programando recordatorios: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async schedule(): Promise<void> {
    const now = Date.now();

    for (const win of ReminderScheduler.WINDOWS) {
      const center = now + win.minutesBefore * 60_000;
      const from = new Date(center - win.toleranceMin * 60_000);
      const to = new Date(center + win.toleranceMin * 60_000);

      // Reservas activas que caen en la ventana.
      const bookings = await this.prisma.$transaction((tx) =>
        tx.booking.findMany({
          where: {
            startsAt: { gte: from, lte: to },
            status: { in: ['CONFIRMED', 'PAID', 'PENDING'] },
            deletedAt: null,
            clientId: { not: null },
          },
          select: {
            id: true,
            code: true,
            clubId: true,
            clientId: true,
            startsAt: true,
            court: { select: { name: true } },
            club: { select: { name: true, timezone: true } },
            client: {
              select: {
                firstName: true,
                phone: true,
                whatsapp: true,
                email: true,
              },
            },
          },
        }),
      );

      for (const b of bookings) {
        if (!b.client) continue;

        // ¿Ya se encoló este recordatorio (esta ventana) para esta reserva?
        const already = await this.prisma.$transaction((tx) =>
          tx.notification.count({
            where: {
              clubId: b.clubId,
              type: 'BOOKING_REMINDER',
              metadata: {
                path: ['bookingCode'],
                equals: b.code,
              } as never,
            },
          }),
        );
        // Un recordatorio por ventana: 24h crea 1, 2h crea otro. Como ambos
        // comparten bookingCode, distinguimos por cantidad esperada.
        const expectedForThisWindow =
          win.key === '24h' ? 1 : 2;
        if (already >= expectedForThisWindow) continue;

        const tz = b.club.timezone ?? 'America/Argentina/Buenos_Aires';
        await this.notifications.enqueueBookingReminder({
          clubId: b.clubId,
          clientId: b.clientId,
          contact: {
            phone: b.client.phone,
            whatsapp: b.client.whatsapp,
            email: b.client.email,
          },
          data: {
            clubName: b.club.name,
            clientName: b.client.firstName,
            courtName: b.court.name,
            date: formatBookingDate(b.startsAt, tz),
            time: formatBookingTime(b.startsAt, tz),
            code: b.code,
          },
        });

        this.log.debug(`Recordatorio ${win.key} encolado para reserva ${b.code}.`);
      }
    }
  }
}
