import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isValidLocalDate,
  localDayRange,
  localDayOfWeek,
  utcToMinuteOfDay,
} from '../time.util';
import { OCCUPYING_STATUSES } from './availability.service';

/**
 * Vista de agenda: el día completo en una sola llamada.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EXISTE ESTE SERVICIO
 * ---------------------------------------------------------------------------
 * `AvailabilityService` responde "¿qué horarios están libres?" y para eso
 * devuelve solo courtId/startsAt/endsAt. Sirve para cotizar, no para dibujar.
 *
 * La pantalla de agenda necesita otra cosa: cada bloque muestra el nombre del
 * cliente, el estado, cuánto falta cobrar y el profesor si es una clase. Con
 * el endpoint de disponibilidad, el front tendría que pedir el detalle de
 * cada reserva por separado — 40 requests para pintar un día normal.
 *
 * Este servicio hace tres queries (canchas, reservas, bloqueos) y devuelve
 * todo lo que la grilla necesita, más los totales del día que el encabezado
 * muestra. Es una vista de lectura optimizada para una pantalla concreta, y
 * está bien que lo sea: forzar que un solo endpoint sirva para cotizar y para
 * dibujar termina devolviendo de más en un caso y de menos en el otro.
 * ---------------------------------------------------------------------------
 */

export interface AgendaBooking {
  id: string;
  code: string;
  courtId: string;
  startsAt: Date;
  endsAt: Date;
  /** Minutos desde medianoche local: lo que la grilla usa para posicionar. */
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
  type: string;
  status: string;
  paymentStatus: string;
  /** Qué mostrar en el bloque: cliente, o el motivo si es un bloqueo. */
  title: string;
  clientId: string | null;
  clientPhone: string | null;
  instructorName: string | null;
  playersCount: number;
  totalPrice: number;
  paidAmount: number;
  pendingAmount: number;
  checkInAt: Date | null;
  hasNotes: boolean;
}

export interface AgendaBlock {
  id: string;
  courtId: string | null;
  startsAt: Date;
  endsAt: Date;
  startMinute: number;
  endMinute: number;
  type: string;
  reason: string;
}

export interface AgendaCourt {
  id: string;
  name: string;
  number: number;
  color: string;
  status: string;
  slotMinutes: number;
  capacity: number;
  environment: string;
  /** Ventana de apertura de ESTA cancha para ESTE día. */
  openMinute: number | null;
  closeMinute: number | null;
}

export interface AgendaDay {
  date: string;
  timezone: string;
  /** Ventana que la grilla debe dibujar: mínimo y máximo de todas las canchas. */
  openMinute: number;
  closeMinute: number;
  courts: AgendaCourt[];
  bookings: AgendaBooking[];
  blocks: AgendaBlock[];
  summary: {
    bookingsCount: number;
    occupancyPercent: number;
    bookedMinutes: number;
    availableMinutes: number;
    revenue: number;
    pendingRevenue: number;
    cancelledCount: number;
    noShowCount: number;
  };
}

@Injectable()
export class AgendaService {
  constructor(private readonly prisma: PrismaService) {}

  async getDay(
    date: string,
    timezone: string,
    filters: { courtId?: string; sportId?: string; instructorId?: string } = {},
  ): Promise<AgendaDay> {
    if (!isValidLocalDate(date)) {
      throw new BadRequestException('Fecha inválida. Formato: YYYY-MM-DD');
    }

    const { start, end } = localDayRange(date, timezone);
    const dayOfWeek = localDayOfWeek(start, timezone);

    const [courts, hours, rawBookings, rawBlocks] = await Promise.all([
      this.prisma.db.court.findMany({
        where: {
          deletedAt: null,
          status: { not: 'DISABLED' },
          ...(filters.courtId ? { id: filters.courtId } : {}),
          ...(filters.sportId ? { sportId: filters.sportId } : {}),
        },
        select: {
          id: true, name: true, number: true, color: true, status: true,
          slotMinutes: true, capacity: true, environment: true,
          hasCustomHours: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { number: 'asc' }],
      }),
      this.prisma.db.operatingHour.findMany({
        where: { dayOfWeek, isClosed: false },
        select: { courtId: true, openMinute: true, closeMinute: true },
      }),
      // Se traen TODOS los estados, no solo los que ocupan: la agenda
      // muestra las canceladas en gris para que el operador vea que ese
      // hueco estuvo tomado y se liberó.
      this.prisma.db.booking.findMany({
        where: {
          deletedAt: null,
          startsAt: { lt: end },
          endsAt: { gt: start },
          ...(filters.courtId ? { courtId: filters.courtId } : {}),
          ...(filters.instructorId ? { instructorId: filters.instructorId } : {}),
        },
        select: {
          id: true, code: true, courtId: true, startsAt: true, endsAt: true,
          durationMinutes: true, type: true, status: true, paymentStatus: true,
          playersCount: true, totalPrice: true, paidAmount: true,
          checkInAt: true, notes: true, clientId: true,
          client: { select: { firstName: true, lastName: true, phone: true } },
          instructor: { select: { firstName: true, lastName: true } },
        },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.db.courtBlock.findMany({
        where: {
          deletedAt: null,
          startsAt: { lt: end },
          endsAt: { gt: start },
        },
        select: {
          id: true, courtId: true, startsAt: true, endsAt: true,
          type: true, reason: true,
        },
      }),
    ]);

    const courtList = this.buildCourts(courts, hours, dayOfWeek);
    const bookings: AgendaBooking[] = rawBookings.map(
      (b: Record<string, unknown>) => this.toAgendaBooking(b, date, timezone),
    );
    const blocks: AgendaBlock[] = rawBlocks.map(
      (b: Record<string, unknown>) => this.toAgendaBlock(b, date, timezone),
    );

    // Ventana global: la unión de todas las canchas. Si una abre a las 8 y
    // otra a las 9, la grilla arranca a las 8 y la segunda muestra su primera
    // hora como cerrada.
    const opens = courtList.map((c) => c.openMinute).filter((m): m is number => m !== null);
    const closes = courtList.map((c) => c.closeMinute).filter((m): m is number => m !== null);

    const openMinute = opens.length ? Math.min(...opens) : 8 * 60;
    let closeMinute = closes.length ? Math.max(...closes) : 24 * 60;

    // Si hay una reserva que termina después del cierre (se extendió el
    // turno), la grilla tiene que llegar hasta ahí o el bloque se corta.
    const latestEnd = Math.max(
      ...bookings.map((b: AgendaBooking) => b.endMinute),
      ...blocks.map((b: AgendaBlock) => b.endMinute),
      closeMinute,
    );
    closeMinute = Math.max(closeMinute, latestEnd);

    return {
      date,
      timezone,
      openMinute,
      closeMinute,
      courts: courtList,
      bookings,
      blocks,
      summary: this.buildSummary(bookings, courtList, openMinute, closeMinute),
    };
  }

  // --- internos ---

  private buildCourts(
    courts: Array<Record<string, unknown>>,
    hours: Array<{ courtId: string | null; openMinute: number; closeMinute: number }>,
    _dayOfWeek: number,
  ): AgendaCourt[] {
    const shared = hours.filter((h) => h.courtId === null);

    return courts.map((c) => {
      const own = hours.filter((h) => h.courtId === c.id);
      const effective = c.hasCustomHours && own.length > 0 ? own : shared;

      return {
        id: String(c.id),
        name: String(c.name),
        number: Number(c.number),
        color: String(c.color),
        status: String(c.status),
        slotMinutes: Number(c.slotMinutes ?? 30),
        capacity: Number(c.capacity ?? 4),
        environment: String(c.environment),
        // null = la cancha no abre este día. La grilla la muestra atenuada.
        openMinute: effective.length ? Math.min(...effective.map((h) => h.openMinute)) : null,
        closeMinute: effective.length ? Math.max(...effective.map((h) => h.closeMinute)) : null,
      };
    });
  }

  private toAgendaBooking(
    b: Record<string, unknown>,
    date: string,
    tz: string,
  ): AgendaBooking {
    const client = b.client as { firstName: string; lastName: string; phone: string | null } | null;
    const instructor = b.instructor as { firstName: string; lastName: string } | null;

    const total = this.num(b.totalPrice);
    const paid = this.num(b.paidAmount);

    // El título del bloque: nombre del cliente, o una etiqueta descriptiva
    // cuando la reserva no tiene titular (mantenimiento, evento).
    const title = client
      ? `${client.firstName} ${client.lastName}`
      : b.type === 'MAINTENANCE'
        ? 'Mantenimiento'
        : b.type === 'TOURNAMENT'
          ? 'Torneo'
          : b.type === 'EVENT'
            ? 'Evento'
            : 'Sin titular';

    return {
      id: String(b.id),
      code: String(b.code),
      courtId: String(b.courtId),
      startsAt: b.startsAt as Date,
      endsAt: b.endsAt as Date,
      startMinute: this.dayMinute(b.startsAt as Date, date, tz),
      endMinute: this.dayMinute(b.endsAt as Date, date, tz, true),
      durationMinutes: Number(b.durationMinutes),
      type: String(b.type),
      status: String(b.status),
      paymentStatus: String(b.paymentStatus),
      title,
      clientId: b.clientId ? String(b.clientId) : null,
      clientPhone: client?.phone ?? null,
      instructorName: instructor
        ? `${instructor.firstName} ${instructor.lastName}`
        : null,
      playersCount: Number(b.playersCount ?? 0),
      totalPrice: total,
      paidAmount: paid,
      pendingAmount: this.round(Math.max(0, total - paid)),
      checkInAt: (b.checkInAt as Date) ?? null,
      // No se manda el texto de la nota: el bloque solo muestra un indicador
      // y el panel lateral la trae al abrirse.
      hasNotes: Boolean(b.notes),
    };
  }

  private toAgendaBlock(
    b: Record<string, unknown>,
    date: string,
    tz: string,
  ): AgendaBlock {
    return {
      id: String(b.id),
      courtId: b.courtId ? String(b.courtId) : null,
      startsAt: b.startsAt as Date,
      endsAt: b.endsAt as Date,
      startMinute: this.dayMinute(b.startsAt as Date, date, tz),
      endMinute: this.dayMinute(b.endsAt as Date, date, tz, true),
      type: String(b.type),
      reason: String(b.reason),
    };
  }

  /**
   * Minuto del día relativo a la fecha de referencia.
   *
   * Puede dar negativo (empezó ayer) o mayor a 1440 (termina mañana). Es
   * intencional: la grilla necesita esos valores para recortar el bloque en
   * el borde correcto en vez de dibujarlo invertido.
   */
  private dayMinute(instant: Date, refDate: string, tz: string, isEnd = false): number {
    const dayStart = localDayRange(refDate, tz).start;
    const diff = Math.round((instant.getTime() - dayStart.getTime()) / 60_000);
    if (isEnd && diff === 0) return 1440;
    return diff;
  }

  private buildSummary(
    bookings: AgendaBooking[],
    courts: AgendaCourt[],
    openMinute: number,
    closeMinute: number,
  ) {
    // Mantenimiento y bloqueos no son ingreso ni "turno vendido", pero sí
    // ocupan la cancha. Se cuentan en ocupación y no en facturación.
    const occupying = bookings.filter((b) =>
      (OCCUPYING_STATUSES as readonly string[]).includes(b.status),
    );
    const revenueRelevant = occupying.filter(
      (b) => b.type !== 'MAINTENANCE' && b.type !== 'EVENT',
    );

    const bookedMinutes = occupying.reduce(
      (s, b) => s + Math.max(0, Math.min(b.endMinute, closeMinute) - Math.max(b.startMinute, openMinute)),
      0,
    );

    const openCourts = courts.filter((c) => c.openMinute !== null);
    const capacityMinutes = openCourts.reduce(
      (s, c) => s + ((c.closeMinute ?? 0) - (c.openMinute ?? 0)),
      0,
    );

    return {
      bookingsCount: revenueRelevant.length,
      occupancyPercent: capacityMinutes > 0
        ? this.round((bookedMinutes / capacityMinutes) * 100)
        : 0,
      bookedMinutes,
      availableMinutes: Math.max(0, capacityMinutes - bookedMinutes),
      revenue: this.round(revenueRelevant.reduce((s, b) => s + b.paidAmount, 0)),
      pendingRevenue: this.round(
        revenueRelevant.reduce((s, b) => s + b.pendingAmount, 0),
      ),
      cancelledCount: bookings.filter((b) =>
        b.status === 'CANCELLED_BY_CLIENT' || b.status === 'CANCELLED_BY_CLUB',
      ).length,
      noShowCount: bookings.filter((b) => b.status === 'NO_SHOW').length,
    };
  }

  private num(v: unknown): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    return Number((v as { toString(): string }).toString());
  }

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
