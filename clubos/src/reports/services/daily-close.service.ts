import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubConfigService } from '../../bookings/services/club-config.service';
import { isValidLocalDate, localDayRange } from '../../bookings/time.util';

/**
 * Cierre de día.
 *
 * ---------------------------------------------------------------------------
 * QUÉ PREGUNTA RESPONDE
 * ---------------------------------------------------------------------------
 * "¿Cómo me fue hoy?" — en una pantalla, sin abrir cinco módulos.
 *
 * Un club cierra a las 23 o 24 y el dueño mira esto al otro día a la mañana.
 * Tiene que ver: cuánto entró, por dónde entró, qué quedó por cobrar, si las
 * cajas cuadraron y qué se vendió en el buffet.
 *
 * ---------------------------------------------------------------------------
 * EL DÍA DEL CLUB NO ES EL DÍA CALENDARIO
 * ---------------------------------------------------------------------------
 * Un turno de 23:30 a 01:00 pertenece al día que empezó, no al siguiente.
 * Todos los cortes usan `localDayRange`, que resuelve la ventana en la zona
 * horaria del club — no en la del servidor, que en producción es UTC y
 * correría el corte tres horas.
 *
 * ---------------------------------------------------------------------------
 * INGRESO NO ES LO MISMO QUE COBRO
 * ---------------------------------------------------------------------------
 * Se reportan tres cifras distintas porque responden preguntas distintas:
 *
 *   facturado  — lo que se vendió hoy (devengado)
 *   cobrado    — lo que efectivamente entró (percibido)
 *   pendiente  — lo que quedó a cobrar
 *
 * Confundirlas es cómo un club cree que tuvo un buen día y a fin de mes no
 * le cierra la plata.
 * ---------------------------------------------------------------------------
 */

export interface DailyClose {
  date: string;
  timezone: string;
  generatedAt: Date;

  totals: {
    /** Vendido hoy, cobrado o no. */
    billed: number;
    /** Efectivamente ingresado hoy, incluso de ventas de otros días. */
    collected: number;
    /** Lo que quedó a cobrar de lo vendido hoy. */
    pending: number;
    /** Salidas de caja: gastos y retiros. */
    outflow: number;
    /** Comisiones de tarjetas y pasarelas. */
    fees: number;
    /** Cobrado menos salidas y comisiones. */
    net: number;
  };

  bookings: {
    total: number;
    played: number;
    cancelled: number;
    noShow: number;
    occupancyPercent: number;
    bookedMinutes: number;
    capacityMinutes: number;
    billed: number;
    collected: number;
    pending: number;
  };

  buffet: {
    sales: number;
    voided: number;
    billed: number;
    collected: number;
    /** Costo de lo vendido, para calcular el margen real. */
    cost: number;
    grossProfit: number;
    marginPercent: number | null;
    topProducts: Array<{
      productId: string | null;
      name: string;
      quantity: number;
      total: number;
    }>;
  };

  byPaymentMethod: Array<{
    code: string;
    name: string;
    kind: string;
    amount: number;
    fees: number;
    net: number;
    count: number;
    /** Cuándo se acredita: efectivo hoy, crédito a 18 días. */
    settlesInDays: number;
  }>;

  cashSessions: Array<{
    id: string;
    register: string;
    operator: string | null;
    openedAt: Date;
    closedAt: Date | null;
    status: string;
    openingAmount: number;
    expectedAmount: number | null;
    countedAmount: number | null;
    difference: number | null;
    differenceReason: string | null;
  }>;

  alerts: Array<{
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    message: string;
    action?: string;
  }>;
}

@Injectable()
export class DailyCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ClubConfigService,
  ) {}

  async getDailyClose(date: string, clubId: string): Promise<DailyClose> {
    if (!isValidLocalDate(date)) {
      throw new BadRequestException('Fecha inválida. Formato: YYYY-MM-DD');
    }

    const tz = await this.config.timezone(clubId);
    const { start, end } = localDayRange(date, tz);

    const [bookings, buffet, payments, sessions, topProducts] = await Promise.all([
      this.getBookingTotals(start, end),
      this.getBuffetTotals(start, end),
      this.getPaymentBreakdown(start, end),
      this.getCashSessions(start, end),
      this.getTopProducts(start, end),
    ]);

    const collected = this.round(
      payments.reduce((s, p) => s + p.amount, 0),
    );
    const fees = this.round(payments.reduce((s, p) => s + p.fees, 0));
    const outflow = await this.getOutflow(start, end);

    const billed = this.round(bookings.billed + buffet.billed);
    const pending = this.round(bookings.pending);

    const close: DailyClose = {
      date,
      timezone: tz,
      generatedAt: new Date(),
      totals: {
        billed,
        collected,
        pending,
        outflow,
        fees,
        net: this.round(collected - outflow - fees),
      },
      bookings,
      buffet: { ...buffet, topProducts },
      byPaymentMethod: payments,
      cashSessions: sessions,
      alerts: [],
    };

    close.alerts = this.buildAlerts(close);
    return close;
  }

  // -------------------------------------------------------------------------

  private async getBookingTotals(start: Date, end: Date) {
    const rows = await this.prisma.tenantQueryRaw<Array<Record<string, unknown>>>(
      `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('COMPLETED','IN_PROGRESS','PAID','CONFIRMED'))::int AS played,
        COUNT(*) FILTER (WHERE status IN ('CANCELLED_BY_CLIENT','CANCELLED_BY_CLUB'))::int AS cancelled,
        COUNT(*) FILTER (WHERE status = 'NO_SHOW')::int AS no_show,
        COALESCE(SUM("totalPrice") FILTER (
          WHERE status NOT IN ('CANCELLED_BY_CLIENT','CANCELLED_BY_CLUB','RESCHEDULED')
        ), 0)::numeric AS billed,
        COALESCE(SUM("paidAmount") FILTER (
          WHERE status NOT IN ('CANCELLED_BY_CLIENT','CANCELLED_BY_CLUB','RESCHEDULED')
        ), 0)::numeric AS collected,
        COALESCE(SUM("durationMinutes") FILTER (
          WHERE status IN ('COMPLETED','IN_PROGRESS','PAID','CONFIRMED')
        ), 0)::int AS booked_minutes
      FROM bookings
      WHERE "clubId" = current_club_id()
        AND "deletedAt" IS NULL
        AND "startsAt" >= $1::timestamptz
        AND "startsAt" < $2::timestamptz
      `,
      start.toISOString(),
      end.toISOString(),
    );

    const r = rows[0] ?? {};
    const billed = this.num(r.billed);
    const collected = this.num(r.collected);
    const bookedMinutes = Number(r.booked_minutes ?? 0);

    // Capacidad del día: suma de las ventanas de apertura de cada cancha.
    const capacity = await this.prisma.tenantQueryRaw<
      Array<{ capacity: number }>
    >(
      `
      SELECT COALESCE(SUM(
        COALESCE(oh."closeMinute", 1440) - COALESCE(oh."openMinute", 0)
      ), 0)::int AS capacity
      FROM courts c
      LEFT JOIN operating_hours oh
        ON oh."clubId" = c."clubId"
       AND (oh."courtId" = c.id OR oh."courtId" IS NULL)
       AND oh."dayOfWeek" = EXTRACT(DOW FROM $1::timestamptz AT TIME ZONE 'UTC')
       AND oh."isClosed" = false
      WHERE c."clubId" = current_club_id()
        AND c."deletedAt" IS NULL
        AND c.status <> 'DISABLED'
      `,
      start.toISOString(),
    );

    const capacityMinutes = Number(capacity[0]?.capacity ?? 0);

    return {
      total: Number(r.total ?? 0),
      played: Number(r.played ?? 0),
      cancelled: Number(r.cancelled ?? 0),
      noShow: Number(r.no_show ?? 0),
      occupancyPercent: capacityMinutes > 0
        ? this.round((bookedMinutes / capacityMinutes) * 100)
        : 0,
      bookedMinutes,
      capacityMinutes,
      billed,
      collected,
      pending: this.round(billed - collected),
    };
  }

  private async getBuffetTotals(start: Date, end: Date) {
    const rows = await this.prisma.tenantQueryRaw<Array<Record<string, unknown>>>(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS sales,
        COUNT(*) FILTER (WHERE status = 'VOIDED')::int AS voided,
        COALESCE(SUM(total) FILTER (WHERE status = 'COMPLETED'), 0)::numeric AS billed,
        COALESCE(SUM("paidAmount") FILTER (WHERE status = 'COMPLETED'), 0)::numeric AS collected
      FROM sales
      WHERE "clubId" = current_club_id()
        AND "createdAt" >= $1::timestamptz
        AND "createdAt" < $2::timestamptz
      `,
      start.toISOString(),
      end.toISOString(),
    );

    // Costo de lo vendido: se toma el costo ACTUAL del producto, no el
    // histórico. Es una aproximación: el costo exacto de cada unidad vendida
    // requeriría costeo por lote, que para un buffet de club es sobreingeniería.
    const costRows = await this.prisma.tenantQueryRaw<Array<{ cost: unknown }>>(
      `
      SELECT COALESCE(SUM(si.quantity * p."costPrice"), 0)::numeric AS cost
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      JOIN products p ON p.id = si."productId"
      WHERE s."clubId" = current_club_id()
        AND s.status = 'COMPLETED'
        AND s."createdAt" >= $1::timestamptz
        AND s."createdAt" < $2::timestamptz
      `,
      start.toISOString(),
      end.toISOString(),
    );

    const r = rows[0] ?? {};
    const billed = this.num(r.billed);
    const cost = this.num(costRows[0]?.cost);
    const grossProfit = this.round(billed - cost);

    return {
      sales: Number(r.sales ?? 0),
      voided: Number(r.voided ?? 0),
      billed,
      collected: this.num(r.collected),
      cost,
      grossProfit,
      marginPercent: billed > 0 ? this.round((grossProfit / billed) * 100) : null,
    };
  }

  private async getTopProducts(start: Date, end: Date) {
    const rows = await this.prisma.tenantQueryRaw<Array<Record<string, unknown>>>(
      `
      SELECT
        si."productId",
        si.description AS name,
        SUM(si.quantity)::numeric AS quantity,
        SUM(si.total)::numeric AS total
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE s."clubId" = current_club_id()
        AND s.status = 'COMPLETED'
        AND s."createdAt" >= $1::timestamptz
        AND s."createdAt" < $2::timestamptz
      GROUP BY si."productId", si.description
      ORDER BY total DESC
      LIMIT 8
      `,
      start.toISOString(),
      end.toISOString(),
    );

    return rows.map((r) => ({
      productId: r.productId ? String(r.productId) : null,
      name: String(r.name),
      quantity: this.num(r.quantity),
      total: this.num(r.total),
    }));
  }

  /**
   * Desglose por medio de pago.
   *
   * Incluye la comisión y los días de acreditación: cobrar $100.000 con
   * tarjeta de crédito no es lo mismo que cobrarlos en efectivo — entran
   * $96.500 y recién en 18 días.
   */
  private async getPaymentBreakdown(start: Date, end: Date) {
    const rows = await this.prisma.tenantQueryRaw<Array<Record<string, unknown>>>(
      `
      SELECT
        pm.code, pm.name, pm.kind, pm."settlementDays",
        COUNT(p.id)::int AS count,
        COALESCE(SUM(p.amount), 0)::numeric AS amount,
        COALESCE(SUM(p."feeAmount"), 0)::numeric AS fees,
        COALESCE(SUM(p."netAmount"), 0)::numeric AS net
      FROM payments p
      JOIN payment_methods pm ON pm.id = p."methodId"
      WHERE p."clubId" = current_club_id()
        AND p.status IN ('COMPLETED','PARTIALLY_REFUNDED')
        AND p."paidAt" >= $1::timestamptz
        AND p."paidAt" < $2::timestamptz
      GROUP BY pm.code, pm.name, pm.kind, pm."settlementDays", pm."sortOrder"
      ORDER BY pm."sortOrder", amount DESC
      `,
      start.toISOString(),
      end.toISOString(),
    );

    return rows.map((r) => ({
      code: String(r.code),
      name: String(r.name),
      kind: String(r.kind),
      amount: this.num(r.amount),
      fees: this.num(r.fees),
      net: this.num(r.net),
      count: Number(r.count ?? 0),
      settlesInDays: Number(r.settlementDays ?? 0),
    }));
  }

  /** Salidas de caja: gastos y retiros del día. */
  private async getOutflow(start: Date, end: Date): Promise<number> {
    const rows = await this.prisma.tenantQueryRaw<Array<{ total: unknown }>>(
      `
      SELECT COALESCE(SUM(amount), 0)::numeric AS total
      FROM cash_movements
      WHERE "clubId" = current_club_id()
        AND direction = 'OUT'
        AND "createdAt" >= $1::timestamptz
        AND "createdAt" < $2::timestamptz
      `,
      start.toISOString(),
      end.toISOString(),
    );
    return this.num(rows[0]?.total);
  }

  private async getCashSessions(start: Date, end: Date) {
    const sessions = await this.prisma.db.cashSession.findMany({
      where: { openedAt: { gte: start, lt: end } },
      select: {
        id: true, status: true, openedAt: true, closedAt: true,
        openingAmount: true, expectedAmount: true, countedAmount: true,
        difference: true, differenceReason: true,
        register: { select: { name: true } },
        membership: {
          select: { user: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: { openedAt: 'asc' },
    });

    return sessions.map((s: Record<string, unknown>) => {
      const reg = s.register as { name: string };
      const mem = s.membership as
        { user: { firstName: string; lastName: string } | null } | null;
      return {
        id: String(s.id),
        register: reg.name,
        operator: mem?.user ? `${mem.user.firstName} ${mem.user.lastName}` : null,
        openedAt: s.openedAt as Date,
        closedAt: (s.closedAt as Date) ?? null,
        status: String(s.status),
        openingAmount: this.num(s.openingAmount),
        expectedAmount: s.expectedAmount !== null ? this.num(s.expectedAmount) : null,
        countedAmount: s.countedAmount !== null ? this.num(s.countedAmount) : null,
        difference: s.difference !== null ? this.num(s.difference) : null,
        differenceReason: (s.differenceReason as string) ?? null,
      };
    });
  }

  /**
   * Alertas del día.
   *
   * Son las cosas que el dueño tiene que resolver, ordenadas por urgencia.
   * Sin esto el reporte es una pila de números; con esto es una lista de
   * tareas.
   */
  private buildAlerts(close: DailyClose): DailyClose['alerts'] {
    const alerts: DailyClose['alerts'] = [];

    const open = close.cashSessions.filter((s) => s.status === 'OPEN');
    if (open.length > 0) {
      alerts.push({
        severity: 'HIGH',
        message: `${open.length} caja(s) sin cerrar: ${open.map((s) => s.register).join(', ')}.`,
        action: 'Cerrá las cajas para que el día quede conciliado.',
      });
    }

    for (const s of close.cashSessions) {
      if (s.difference !== null && s.difference !== 0) {
        alerts.push({
          severity: Math.abs(s.difference) > 5000 ? 'HIGH' : 'MEDIUM',
          message:
            `${s.register} cerró con ${s.difference < 0 ? 'faltante' : 'sobrante'} ` +
            `de ${this.money(Math.abs(s.difference))}` +
            (s.differenceReason ? `: ${s.differenceReason}` : '.'),
          // Un sobrante suele ser un cobro sin registrar, que contablemente
          // es peor que un faltante: hay ventas que no están asentadas.
          action: s.difference > 0
            ? 'Revisá si hubo un cobro sin registrar.'
            : undefined,
        });
      }
    }

    if (close.totals.pending > 0) {
      alerts.push({
        severity: close.totals.pending > 50_000 ? 'MEDIUM' : 'LOW',
        message: `Quedaron ${this.money(close.totals.pending)} sin cobrar.`,
        action: 'Revisá los turnos con saldo pendiente.',
      });
    }

    if (close.bookings.noShow > 0) {
      alerts.push({
        severity: close.bookings.noShow >= 3 ? 'MEDIUM' : 'LOW',
        message: `${close.bookings.noShow} cliente(s) no se presentaron.`,
      });
    }

    if (close.buffet.voided > 0) {
      alerts.push({
        severity: close.buffet.voided >= 3 ? 'MEDIUM' : 'LOW',
        message: `${close.buffet.voided} venta(s) anuladas en el buffet.`,
        action: close.buffet.voided >= 3
          ? 'Varias anulaciones en un día pueden indicar un problema de carga.'
          : undefined,
      });
    }

    if (close.bookings.occupancyPercent < 25 && close.bookings.capacityMinutes > 0) {
      alerts.push({
        severity: 'LOW',
        message: `Ocupación del ${close.bookings.occupancyPercent}%.`,
        action: 'Considerá una promoción para los horarios vacíos.',
      });
    }

    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  private num(v: unknown): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    return Number((v as { toString(): string }).toString());
  }

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }

  private money(n: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
    }).format(n);
  }
}
