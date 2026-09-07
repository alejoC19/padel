import { BadRequestException, Injectable } from '@nestjs/common';
import type { BookingStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  addLocalDays,
  formatMinute,
  isValidLocalDate,
  localDayOfWeek,
  localDayRange,
  localToUtc,
  utcToMinuteOfDay,
} from '../time.util';

/** Estados que NO liberan la cancha. Debe coincidir con el EXCLUDE de SQL. */
export const OCCUPYING_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PAID',
  'IN_PROGRESS',
  'COMPLETED',
] as const;

export interface SlotQuery {
  date: string; // YYYY-MM-DD local
  courtId?: string;
  durationMinutes?: number;
  sportId?: string;
}

export interface Slot {
  startMinute: number;
  endMinute: number;
  startLabel: string;
  endLabel: string;
  startsAt: Date;
  endsAt: Date;
  available: boolean;
  reason?: 'BOOKED' | 'BLOCKED' | 'CLOSED' | 'PAST' | 'TOO_LATE';
}

export interface CourtAvailability {
  courtId: string;
  courtName: string;
  courtNumber: number;
  color: string;
  slots: Slot[];
}

interface Interval {
  start: number;
  end: number;
  kind: 'BOOKED' | 'BLOCKED';
}

/**
 * Cálculo de disponibilidad.
 *
 * ---------------------------------------------------------------------------
 * ACLARACIÓN IMPORTANTE
 * ---------------------------------------------------------------------------
 * Este servicio produce la vista de la agenda: qué se le muestra al operador
 * o al cliente. NO es la fuente de verdad de la disponibilidad.
 *
 * La verdad la tiene el EXCLUDE constraint de Postgres. Entre que este
 * servicio calcula un hueco y el usuario confirma, otro puede haber
 * reservado. El insert fallará con 409 BOOKING_OVERLAP y está bien: es la
 * única garantía real bajo concurrencia.
 *
 * Tratar este cálculo como autoritativo y saltear la validación del motor
 * es exactamente el bug que tenía PadelPRO.
 * ---------------------------------------------------------------------------
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async getDayAvailability(
    q: SlotQuery,
    timezone: string,
  ): Promise<CourtAvailability[]> {
    if (!isValidLocalDate(q.date)) {
      throw new BadRequestException('Fecha inválida. Formato esperado: YYYY-MM-DD');
    }

    const courts = await this.prisma.db.court.findMany({
      where: {
        deletedAt: null,
        status: 'AVAILABLE',
        ...(q.courtId ? { id: q.courtId } : {}),
        ...(q.sportId ? { sportId: q.sportId } : {}),
      },
      select: {
        id: true,
        name: true,
        number: true,
        color: true,
        slotMinutes: true,
        hasCustomHours: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { number: 'asc' }],
    });

    if (courts.length === 0) return [];

    const { start, end } = localDayRange(q.date, timezone);
    const dayOfWeek = localDayOfWeek(start, timezone);

    const [hours, bookings, blocks] = await Promise.all([
      this.prisma.db.operatingHour.findMany({
        where: { dayOfWeek, isClosed: false },
        select: {
          courtId: true,
          openMinute: true,
          closeMinute: true,
        },
      }),
      // Se traen las reservas que TOCAN el día, no solo las que empiezan
      // en él: un turno de 23:30 a 01:00 ocupa parte del día siguiente.
      this.prisma.db.booking.findMany({
        where: {
          deletedAt: null,
          status: { in: OCCUPYING_STATUSES as unknown as BookingStatus[] },
          startsAt: { lt: end },
          endsAt: { gt: start },
          ...(q.courtId ? { courtId: q.courtId } : {}),
        },
        select: { courtId: true, startsAt: true, endsAt: true },
      }),
      this.prisma.db.courtBlock.findMany({
        where: {
          deletedAt: null,
          startsAt: { lt: end },
          endsAt: { gt: start },
        },
        select: { courtId: true, startsAt: true, endsAt: true },
      }),
    ]);

    const now = new Date();

    type CourtRow = {
      id: string;
      name: string;
      number: number;
      color: string;
      slotMinutes: number;
      hasCustomHours: boolean;
    };

    return (courts as CourtRow[]).map((court: CourtRow) =>
      this.buildCourtAvailability({
        court,
        hours,
        bookings,
        blocks,
        date: q.date,
        timezone,
        requestedDuration: q.durationMinutes,
        now,
      }),
    );
  }

  /** Rango de días. Usado por la vista semanal. */
  async getRangeAvailability(
    fromDate: string,
    days: number,
    timezone: string,
    q: Omit<SlotQuery, 'date'> = {},
  ): Promise<Record<string, CourtAvailability[]>> {
    if (days < 1 || days > 31) {
      throw new BadRequestException('El rango debe ser de 1 a 31 días');
    }
    const out: Record<string, CourtAvailability[]> = {};
    for (let i = 0; i < days; i++) {
      const date = addLocalDays(fromDate, i);
      out[date] = await this.getDayAvailability({ ...q, date }, timezone);
    }
    return out;
  }

  /**
   * Chequeo puntual antes de crear una reserva.
   *
   * Es un pre-check para dar un mensaje claro, NO la validación final:
   * la definitiva la hace el EXCLUDE constraint al insertar.
   */
  async isSlotFree(
    courtId: string,
    startsAt: Date,
    endsAt: Date,
    excludeBookingId?: string,
  ): Promise<boolean> {
    const [booking, block] = await Promise.all([
      this.prisma.db.booking.findFirst({
        where: {
          courtId,
          deletedAt: null,
          status: { in: OCCUPYING_STATUSES as unknown as BookingStatus[] },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
        },
        select: { id: true },
      }),
      this.prisma.db.courtBlock.findFirst({
        where: {
          deletedAt: null,
          OR: [{ courtId }, { courtId: null }],
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        select: { id: true },
      }),
    ]);

    return !booking && !block;
  }

  /** Valida que el turno caiga dentro del horario de apertura. */
  async isWithinOperatingHours(
    courtId: string,
    startsAt: Date,
    endsAt: Date,
    timezone: string,
  ): Promise<boolean> {
    const dayOfWeek = localDayOfWeek(startsAt, timezone);

    const hours = await this.prisma.db.operatingHour.findMany({
      where: {
        dayOfWeek,
        isClosed: false,
        OR: [{ courtId }, { courtId: null }],
      },
      select: { courtId: true, openMinute: true, closeMinute: true },
    });

    if (hours.length === 0) return false;

    type HourRow = { courtId: string | null; openMinute: number; closeMinute: number };
    const rows = hours as HourRow[];

    // El horario propio de la cancha pisa al del club.
    const own = rows.filter((h: HourRow) => h.courtId === courtId);
    const effective = own.length > 0 ? own : rows;

    const startMin = utcToMinuteOfDay(startsAt, timezone);
    let endMin = utcToMinuteOfDay(endsAt, timezone);

    // Si termina justo a medianoche, Intl devuelve 0: normalizar a 1440
    // para que no parezca que termina antes de empezar.
    if (endMin === 0) endMin = 1440;
    if (endMin <= startMin) endMin += 1440;

    return effective.some(
      (h: HourRow) => startMin >= h.openMinute && endMin <= h.closeMinute,
    );
  }

  // --- internos ---

  private buildCourtAvailability(args: {
    court: {
      id: string;
      name: string;
      number: number;
      color: string;
      slotMinutes: number;
      hasCustomHours: boolean;
    };
    hours: Array<{
      courtId: string | null;
      openMinute: number;
      closeMinute: number;
    }>;
    bookings: Array<{ courtId: string; startsAt: Date; endsAt: Date }>;
    blocks: Array<{ courtId: string | null; startsAt: Date; endsAt: Date }>;
    date: string;
    timezone: string;
    requestedDuration?: number;
    now: Date;
  }): CourtAvailability {
    const { court, date, timezone, now } = args;

    const own = args.hours.filter((h) => h.courtId === court.id);
    const shared = args.hours.filter((h) => h.courtId === null);
    const effectiveHours = court.hasCustomHours && own.length > 0 ? own : shared;

    const occupied: Interval[] = [
      ...args.bookings
        .filter((b) => b.courtId === court.id)
        .map((b) => ({
          start: this.toDayMinute(b.startsAt, date, timezone),
          end: this.toDayMinute(b.endsAt, date, timezone, true),
          kind: 'BOOKED' as const,
        })),
      ...args.blocks
        .filter((b) => b.courtId === court.id || b.courtId === null)
        .map((b) => ({
          start: this.toDayMinute(b.startsAt, date, timezone),
          end: this.toDayMinute(b.endsAt, date, timezone, true),
          kind: 'BLOCKED' as const,
        })),
    ];

    const step = court.slotMinutes || 30;
    const duration = args.requestedDuration ?? step;
    const slots: Slot[] = [];

    for (const h of effectiveHours) {
      for (let m = h.openMinute; m + duration <= h.closeMinute; m += step) {
        const startsAt = localToUtc(date, m, timezone);
        const endsAt = localToUtc(date, m + duration, timezone);
        const end = m + duration;

        const hit = occupied.find((o) => m < o.end && end > o.start);
        const isPast = startsAt <= now;

        slots.push({
          startMinute: m,
          endMinute: end,
          startLabel: formatMinute(m),
          endLabel: formatMinute(end),
          startsAt,
          endsAt,
          available: !hit && !isPast,
          reason: hit ? hit.kind : isPast ? 'PAST' : undefined,
        });
      }
    }

    slots.sort((a, b) => a.startMinute - b.startMinute);

    return {
      courtId: court.id,
      courtName: court.name,
      courtNumber: court.number,
      color: court.color,
      slots,
    };
  }

  /**
   * Convierte un instante al minuto del día de referencia.
   *
   * Si la reserva empieza el día anterior o termina el siguiente, se
   * extrapola fuera de [0,1440] para que la comparación de intervalos
   * siga siendo correcta. Sin esto, un turno 23:30-01:00 aparecería como
   * 1410-60 (fin < inicio) y no bloquearía nada.
   */
  private toDayMinute(
    instant: Date,
    refDate: string,
    timezone: string,
    isEnd = false,
  ): number {
    const dayStart = localToUtc(refDate, 0, timezone);
    const diffMinutes = Math.round(
      (instant.getTime() - dayStart.getTime()) / 60_000,
    );
    // Un fin exactamente a medianoche del día siguiente da 1440, correcto.
    if (isEnd && diffMinutes === 0) return 1440;
    return diffMinutes;
  }
}
