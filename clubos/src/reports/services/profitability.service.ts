import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubConfigService } from '../../bookings/services/club-config.service';
import { isValidLocalDate, localDayRange } from '../../bookings/time.util';

/**
 * Rentabilidad.
 *
 * ---------------------------------------------------------------------------
 * LA PREGUNTA REAL
 * ---------------------------------------------------------------------------
 * No es "qué vendo más" sino "qué me deja más plata". Son cosas distintas: el
 * agua se vende el doble que la cerveza y deja la mitad.
 *
 * Por eso el orden por defecto es por ganancia bruta, no por unidades ni por
 * facturación. Un ranking por unidades le hace reponer lo que menos le rinde.
 * ---------------------------------------------------------------------------
 */

export interface ProductProfit {
  productId: string;
  name: string;
  category: string | null;
  unitsSold: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  marginPercent: number | null;
  /** Cuánto aporta al total de ganancia del período. */
  shareOfProfit: number;
  currentStock: number;
  /** Días que dura el stock al ritmo de venta del período. */
  daysOfStock: number | null;
}

export interface CourtProfit {
  courtId: string;
  name: string;
  bookings: number;
  bookedMinutes: number;
  revenue: number;
  /** Facturación por hora ocupada: compara canchas de distinto uso. */
  revenuePerHour: number;
  occupancyPercent: number;
}

@Injectable()
export class ProfitabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ClubConfigService,
  ) {}

  async getProductProfitability(
    from: string,
    to: string,
    clubId: string,
  ): Promise<{
    period: { from: string; to: string; days: number };
    totals: { revenue: number; cost: number; grossProfit: number; marginPercent: number | null };
    products: ProductProfit[];
  }> {
    const { start, end, days } = await this.resolveRange(from, to, clubId);

    const rows = await this.prisma.tenantQueryRaw<Array<Record<string, unknown>>>(
      `
      SELECT
        p.id, p.name, p."stockQty", p."costPrice",
        pc.name AS category,
        COALESCE(SUM(si.quantity), 0)::numeric AS units,
        COALESCE(SUM(si.total), 0)::numeric AS revenue,
        -- Costo aproximado con el precio actual. El costeo exacto por lote
        -- es sobreingeniería para un buffet de club.
        COALESCE(SUM(si.quantity * p."costPrice"), 0)::numeric AS cost
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      JOIN products p ON p.id = si."productId"
      LEFT JOIN product_categories pc ON pc.id = p.categoryId
      WHERE s."clubId" = current_club_id()
        AND s.status = 'COMPLETED'
        AND s."createdAt" >= $1::timestamptz
        AND s."createdAt" < $2::timestamptz
      GROUP BY p.id, p.name, p."stockQty", p."costPrice", pc.name
      HAVING SUM(si.quantity) > 0
      ORDER BY (COALESCE(SUM(si.total),0) - COALESCE(SUM(si.quantity * p."costPrice"),0)) DESC
      `,
      start.toISOString(),
      end.toISOString(),
    );

    const totalProfit = rows.reduce(
      (s, r) => s + (this.num(r.revenue) - this.num(r.cost)),
      0,
    );

    const products: ProductProfit[] = rows.map((r) => {
      const revenue = this.num(r.revenue);
      const cost = this.num(r.cost);
      const grossProfit = this.round(revenue - cost);
      const units = this.num(r.units);
      const stock = this.num(r.stockQty);
      const perDay = days > 0 ? units / days : 0;

      return {
        productId: String(r.id),
        name: String(r.name),
        category: r.category ? String(r.category) : null,
        unitsSold: units,
        revenue,
        cost,
        grossProfit,
        marginPercent: revenue > 0 ? this.round((grossProfit / revenue) * 100) : null,
        shareOfProfit: totalProfit > 0
          ? this.round((grossProfit / totalProfit) * 100)
          : 0,
        currentStock: stock,
        // Cuántos días aguanta el stock al ritmo actual. Es el número que
        // define cuándo llamar al proveedor.
        daysOfStock: perDay > 0 ? this.round(stock / perDay) : null,
      };
    });

    const revenue = this.round(products.reduce((s, p) => s + p.revenue, 0));
    const cost = this.round(products.reduce((s, p) => s + p.cost, 0));
    const grossProfit = this.round(revenue - cost);

    return {
      period: { from, to, days },
      totals: {
        revenue,
        cost,
        grossProfit,
        marginPercent: revenue > 0 ? this.round((grossProfit / revenue) * 100) : null,
      },
      products,
    };
  }

  /**
   * Rentabilidad por cancha.
   *
   * `revenuePerHour` es la métrica que importa: una cancha techada que se usa
   * poco pero se cobra caro puede rendir más que una descubierta siempre
   * llena. Comparar por facturación total esconde eso.
   */
  async getCourtProfitability(
    from: string,
    to: string,
    clubId: string,
  ): Promise<{ period: { from: string; to: string; days: number }; courts: CourtProfit[] }> {
    const { start, end, days } = await this.resolveRange(from, to, clubId);

    const rows = await this.prisma.tenantQueryRaw<Array<Record<string, unknown>>>(
      `
      SELECT
        c.id, c.name,
        COUNT(b.id)::int AS bookings,
        COALESCE(SUM(b."durationMinutes"), 0)::int AS minutes,
        COALESCE(SUM(b."totalPrice"), 0)::numeric AS revenue
      FROM courts c
      LEFT JOIN bookings b
        ON b."courtId" = c.id
       AND b."deletedAt" IS NULL
       AND b.status NOT IN ('CANCELLED_BY_CLIENT','CANCELLED_BY_CLUB','RESCHEDULED')
       AND b."startsAt" >= $1::timestamptz
       AND b."startsAt" < $2::timestamptz
      WHERE c."clubId" = current_club_id()
        AND c."deletedAt" IS NULL
        AND c.status <> 'DISABLED'
      GROUP BY c.id, c.name, c."sortOrder", c.number
      ORDER BY revenue DESC
      `,
      start.toISOString(),
      end.toISOString(),
    );

    // Capacidad aproximada: 16 horas por día por cancha. Se usa una constante
    // en vez de leer los horarios porque estos pueden haber cambiado durante
    // el período, y un porcentaje construido sobre una capacidad variable no
    // se puede comparar entre canchas.
    const capacityMinutes = days * 16 * 60;

    return {
      period: { from, to, days },
      courts: rows.map((r) => {
        const minutes = Number(r.minutes ?? 0);
        const revenue = this.num(r.revenue);
        return {
          courtId: String(r.id),
          name: String(r.name),
          bookings: Number(r.bookings ?? 0),
          bookedMinutes: minutes,
          revenue,
          revenuePerHour: minutes > 0
            ? this.round(revenue / (minutes / 60))
            : 0,
          occupancyPercent: capacityMinutes > 0
            ? this.round((minutes / capacityMinutes) * 100)
            : 0,
        };
      }),
    };
  }

  /**
   * Ocupación por franja horaria y día de semana.
   *
   * Es el reporte que responde "¿a qué hora tengo la cancha vacía?", que es
   * la pregunta previa a decidir un descuento.
   */
  async getOccupancyHeatmap(from: string, to: string, clubId: string) {
    const { start, end } = await this.resolveRange(from, to, clubId);
    const tz = await this.config.timezone(clubId);

    const rows = await this.prisma.tenantQueryRaw<Array<Record<string, unknown>>>(
      `
      SELECT
        EXTRACT(DOW FROM b."startsAt" AT TIME ZONE $3)::int AS day_of_week,
        EXTRACT(HOUR FROM b."startsAt" AT TIME ZONE $3)::int AS hour,
        COUNT(*)::int AS bookings,
        COALESCE(SUM(b."totalPrice"), 0)::numeric AS revenue
      FROM bookings b
      WHERE b."clubId" = current_club_id()
        AND b."deletedAt" IS NULL
        AND b.status NOT IN ('CANCELLED_BY_CLIENT','CANCELLED_BY_CLUB','RESCHEDULED')
        AND b."startsAt" >= $1::timestamptz
        AND b."startsAt" < $2::timestamptz
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour
      `,
      start.toISOString(),
      end.toISOString(),
      tz,
    );

    return rows.map((r) => ({
      dayOfWeek: Number(r.day_of_week),
      hour: Number(r.hour),
      bookings: Number(r.bookings ?? 0),
      revenue: this.num(r.revenue),
    }));
  }

  // -------------------------------------------------------------------------

  private async resolveRange(from: string, to: string, clubId: string) {
    if (!isValidLocalDate(from) || !isValidLocalDate(to)) {
      throw new BadRequestException('Fechas inválidas. Formato: YYYY-MM-DD');
    }
    if (from > to) {
      throw new BadRequestException('La fecha inicial es posterior a la final.');
    }

    const tz = await this.config.timezone(clubId);
    const start = localDayRange(from, tz).start;
    const end = localDayRange(to, tz).end;
    const days = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 86_400_000),
    );

    if (days > 400) {
      throw new BadRequestException(
        'El período no puede superar los 400 días. Acotá el rango.',
      );
    }

    return { start, end, days };
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
