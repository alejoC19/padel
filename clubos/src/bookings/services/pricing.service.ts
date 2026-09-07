import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { localDayOfWeek, utcToMinuteOfDay } from '../time.util';

export interface PriceQuery {
  courtId: string;
  startsAt: Date;
  durationMinutes: number;
  bookingType?: string;
  clientId?: string | null;
  timezone: string;
}

export interface PriceQuote {
  basePrice: number;
  discountPercent: number;
  discountAmount: number;
  totalPrice: number;
  /** Regla que ganó. Útil para explicar el precio en la UI. */
  appliedRuleId: string | null;
  priceListId: string;
  breakdown: string[];
}

interface CandidateRule {
  id: string;
  courtId: string | null;
  dayOfWeek: number | null;
  fromMinute: number | null;
  toMinute: number | null;
  durationMinutes: number | null;
  bookingType: string | null;
  price: unknown;
  priority: number;
}

/**
 * Motor de resolución de precios.
 *
 * ---------------------------------------------------------------------------
 * ALGORITMO
 * ---------------------------------------------------------------------------
 * 1. Se elige la lista de precios: la asignada al cliente, o la default.
 * 2. Se filtran las reglas aplicables al turno concreto.
 * 3. Se ordenan por (especificidad, prioridad) y gana la primera.
 *
 * ESPECIFICIDAD: cada dimensión que la regla fija suma peso. Una regla que
 * dice "cancha 3, sábados, 20-24hs" es más específica que "sábados". Los
 * pesos son potencias de 2 para que ninguna combinación de dimensiones
 * flojas supere a una fuerte:
 *
 *      cancha      8
 *      ventana     4
 *      día         2
 *      tipo        1
 *      duración    1   (casi siempre presente; poco discriminante)
 *
 * `priority` desempata cuando dos reglas son igual de específicas. Permite
 * al club forzar una promoción por encima de la regla normal sin tener que
 * inventar dimensiones artificiales.
 *
 * Si no hay regla aplicable se lanza excepción en vez de devolver 0: cobrar
 * $0 en silencio es peor que fallar visiblemente.
 * ---------------------------------------------------------------------------
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async quote(q: PriceQuery): Promise<PriceQuote> {
    const client = q.clientId
      ? await this.prisma.db.client.findUnique({
          where: { id: q.clientId },
          select: { priceListId: true, discountPercent: true },
        })
      : null;

    const priceList = await this.resolvePriceList(client?.priceListId ?? null);

    const dayOfWeek = localDayOfWeek(q.startsAt, q.timezone);
    const minuteOfDay = utcToMinuteOfDay(q.startsAt, q.timezone);

    const rules: CandidateRule[] = await this.prisma.db.priceRule.findMany({
      where: {
        priceListId: priceList.id,
        isActive: true,
        deletedAt: null,
        OR: [{ courtId: q.courtId }, { courtId: null }],
        AND: [
          { OR: [{ dayOfWeek }, { dayOfWeek: null }] },
          {
            OR: [
              { durationMinutes: q.durationMinutes },
              { durationMinutes: null },
            ],
          },
          {
            OR: [
              { bookingType: (q.bookingType ?? 'REGULAR') as never },
              { bookingType: null },
            ],
          },
        ],
      },
      select: {
        id: true,
        courtId: true,
        dayOfWeek: true,
        fromMinute: true,
        toMinute: true,
        durationMinutes: true,
        bookingType: true,
        price: true,
        priority: true,
      },
    });

    // La ventana horaria se filtra en memoria: expresarla en SQL con
    // NULLs en ambos extremos genera una condición ilegible y no aporta
    // performance con el volumen típico (decenas de reglas por lista).
    const applicable = rules.filter((r) =>
      this.matchesWindow(r, minuteOfDay, q.durationMinutes),
    );

    if (applicable.length === 0) {
      throw new NotFoundException(
        'No hay una regla de precio para ese horario y duración. ' +
          'Revisá la lista de precios del club.',
      );
    }

    const winner = applicable.sort(
      (a, b) =>
        this.specificity(b) - this.specificity(a) ||
        b.priority - a.priority ||
        // Desempate final determinista: sin esto, dos reglas idénticas
        // podrían alternar entre requests según el orden que devuelva PG.
        a.id.localeCompare(b.id),
    )[0];

    const basePrice = this.toNumber(winner.price);
    const discountPercent = this.toNumber(client?.discountPercent ?? 0);
    const discountAmount = this.round(basePrice * (discountPercent / 100));
    const totalPrice = this.round(basePrice - discountAmount);

    const breakdown = [`Tarifa base: ${this.money(basePrice)}`];
    if (discountPercent > 0) {
      breakdown.push(
        `Descuento cliente ${discountPercent}%: -${this.money(discountAmount)}`,
      );
    }

    return {
      basePrice,
      discountPercent,
      discountAmount,
      totalPrice,
      appliedRuleId: winner.id,
      priceListId: priceList.id,
      breakdown,
    };
  }

  /** Precio de varios turnos (usado en reservas recurrentes). */
  async quoteMany(queries: PriceQuery[]): Promise<PriceQuote[]> {
    return Promise.all(queries.map((q) => this.quote(q)));
  }

  // --- internos ---

  private async resolvePriceList(clientPriceListId: string | null) {
    if (clientPriceListId) {
      const assigned = await this.prisma.db.priceList.findFirst({
        where: { id: clientPriceListId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (assigned) return assigned;
      // Lista asignada inactiva o borrada: se cae a la default en vez de
      // fallar, para no bloquear la operación del club.
    }

    const def = await this.prisma.db.priceList.findFirst({
      where: { isDefault: true, isActive: true, deletedAt: null },
      select: { id: true },
    });

    if (!def) {
      throw new NotFoundException(
        'El club no tiene una lista de precios por defecto configurada.',
      );
    }
    return def;
  }

  /**
   * La regla aplica si el turno arranca dentro de la ventana.
   *
   * DECISIÓN: se evalúa solo el INICIO, no la superposición completa. Un
   * turno de 21:30 a 23:00 con ventana "pico 18-22" paga tarifa pico
   * completa. Es lo que hacen los clubes en la práctica y evita tener que
   * prorratear precios por tramo, que nadie sabe explicar al cliente.
   */
  private matchesWindow(
    r: CandidateRule,
    minuteOfDay: number,
    _duration: number,
  ): boolean {
    if (r.fromMinute === null && r.toMinute === null) return true;
    const from = r.fromMinute ?? 0;
    const to = r.toMinute ?? 1440;
    return minuteOfDay >= from && minuteOfDay < to;
  }

  private specificity(r: CandidateRule): number {
    let s = 0;
    if (r.courtId !== null) s += 8;
    if (r.fromMinute !== null || r.toMinute !== null) s += 4;
    if (r.dayOfWeek !== null) s += 2;
    if (r.bookingType !== null) s += 1;
    if (r.durationMinutes !== null) s += 1;
    return s;
  }

  /** Prisma devuelve Decimal; convertir con precisión de centavos. */
  private toNumber(v: unknown): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    return Number((v as { toString(): string }).toString());
  }

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }

  private money(n: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 2,
    }).format(n);
  }
}
