import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Flujo de fondos proyectado.
 *
 * ---------------------------------------------------------------------------
 * LA PREGUNTA QUE RESUELVE
 * ---------------------------------------------------------------------------
 * "¿Me alcanza para pagar sueldos el viernes?"
 *
 * Un club puede tener la caja cuadrada y estar en problemas: cobró todo con
 * tarjeta de crédito a 18 días y tiene que pagar el alquiler el lunes. El
 * saldo de hoy no dice nada sobre eso.
 *
 * ---------------------------------------------------------------------------
 * QUÉ ENTRA EN LA PROYECCIÓN
 * ---------------------------------------------------------------------------
 * Solo lo COMPROMETIDO, no lo estimado:
 *
 *   entradas — cobros con tarjeta pendientes de acreditación
 *              (el banco ya los tiene, falta que los libere)
 *   salidas  — gastos con vencimiento cargado
 *
 * Deliberadamente NO se proyectan ingresos futuros por reservas: una reserva
 * puede cancelarse, y una proyección optimista es peor que ninguna porque
 * lleva a comprometer plata que no va a estar.
 * ---------------------------------------------------------------------------
 */

export interface CashFlowDay {
  date: string;
  /** Cobros con tarjeta que se acreditan ese día. */
  inflow: number;
  /** Gastos que vencen ese día. */
  outflow: number;
  net: number;
  /** Saldo acumulado desde hoy. */
  runningBalance: number;
  /** El saldo proyectado cae por debajo de cero. */
  isNegative: boolean;
  detail: {
    settlements: Array<{ code: string; amount: number; method: string }>;
    expenses: Array<{ code: string; concept: string; amount: number; supplier: string | null }>;
  };
}

export interface CashFlowProjection {
  from: string;
  to: string;
  /** Punto de partida: bancos + efectivo en cajas abiertas. */
  openingBalance: number;
  breakdown: {
    banks: number;
    cashOnHand: number;
  };
  totals: {
    expectedInflow: number;
    committedOutflow: number;
    projectedBalance: number;
  };
  days: CashFlowDay[];
  alerts: Array<{ severity: 'HIGH' | 'MEDIUM'; message: string }>;
}

@Injectable()
export class CashFlowService {
  constructor(private readonly prisma: PrismaService) {}

  async project(days = 30): Promise<CashFlowProjection> {
    if (days < 1 || days > 180) {
      throw new BadRequestException('La proyección debe ser de 1 a 180 días.');
    }

    const today = this.todayISO();
    const until = this.addDays(today, days);

    const [banks, cashOnHand, settlements, expenses] = await Promise.all([
      this.getBankBalance(),
      this.getCashOnHand(),
      this.getPendingSettlements(today, until),
      this.getUpcomingExpenses(today, until),
    ]);

    const openingBalance = this.round(banks + cashOnHand);

    // Se arma un mapa día por día para que la proyección no tenga huecos:
    // un día sin movimientos igual muestra el saldo, que es lo que se mira.
    const byDay = new Map<string, CashFlowDay>();
    for (let i = 0; i <= days; i++) {
      const date = this.addDays(today, i);
      byDay.set(date, {
        date,
        inflow: 0,
        outflow: 0,
        net: 0,
        runningBalance: 0,
        isNegative: false,
        detail: { settlements: [], expenses: [] },
      });
    }

    for (const s of settlements) {
      const day = byDay.get(s.date);
      if (!day) continue;
      day.inflow = this.round(day.inflow + s.amount);
      day.detail.settlements.push({
        code: s.code, amount: s.amount, method: s.method,
      });
    }

    for (const e of expenses) {
      const day = byDay.get(e.date);
      if (!day) continue;
      day.outflow = this.round(day.outflow + e.amount);
      day.detail.expenses.push({
        code: e.code, concept: e.concept, amount: e.amount, supplier: e.supplier,
      });
    }

    let running = openingBalance;
    const list = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
    for (const d of list) {
      d.net = this.round(d.inflow - d.outflow);
      running = this.round(running + d.net);
      d.runningBalance = running;
      d.isNegative = running < 0;
    }

    const expectedInflow = this.round(list.reduce((s, d) => s + d.inflow, 0));
    const committedOutflow = this.round(list.reduce((s, d) => s + d.outflow, 0));

    return {
      from: today,
      to: until,
      openingBalance,
      breakdown: { banks: this.round(banks), cashOnHand: this.round(cashOnHand) },
      totals: {
        expectedInflow,
        committedOutflow,
        projectedBalance: running,
      },
      days: list,
      alerts: this.buildAlerts(list, openingBalance),
    };
  }

  // -------------------------------------------------------------------------

  private async getBankBalance(): Promise<number> {
    const rows = await this.prisma.tenantQueryRaw<Array<{ total: unknown }>>(`
      SELECT COALESCE(SUM("currentBalance"), 0)::numeric AS total
      FROM bank_accounts
      WHERE "clubId" = current_club_id() AND "deletedAt" IS NULL AND "isActive" = true
    `);
    return this.num(rows[0]?.total);
  }

  /**
   * Efectivo en cajas abiertas.
   *
   * Se calcula desde los movimientos y no desde un campo guardado: el
   * esperado de una caja abierta cambia con cada cobro, y un valor
   * almacenado quedaría viejo entre actualizaciones.
   */
  private async getCashOnHand(): Promise<number> {
    const rows = await this.prisma.tenantQueryRaw<Array<{ total: unknown }>>(`
      SELECT COALESCE(SUM(
        s."openingAmount"
        + COALESCE((
          SELECT SUM(CASE WHEN m.direction = 'IN' THEN m.amount ELSE -m.amount END)
          FROM cash_movements m
          LEFT JOIN payment_methods pm ON pm.id = m."paymentMethodId"
          WHERE m."sessionId" = s.id
            AND COALESCE(pm."affectsCashCount", true) = true
        ), 0)
      ), 0)::numeric AS total
      FROM cash_sessions s
      WHERE s."clubId" = current_club_id() AND s.status = 'OPEN'
    `);
    return this.num(rows[0]?.total);
  }

  /** Cobros con tarjeta que el banco todavía no liberó. */
  private async getPendingSettlements(from: string, to: string) {
    const rows = await this.prisma.tenantQueryRaw<Array<Record<string, unknown>>>(
      `
      SELECT p.code, p."netAmount", p."settlementDate", pm.name AS method
      FROM payments p
      JOIN payment_methods pm ON pm.id = p."methodId"
      WHERE p."clubId" = current_club_id()
        AND p.status IN ('COMPLETED','PARTIALLY_REFUNDED')
        AND p."settledAt" IS NULL
        AND p."settlementDate" IS NOT NULL
        AND p."settlementDate" >= $1::date
        AND p."settlementDate" <= $2::date
      ORDER BY p."settlementDate"
      `,
      from,
      to,
    );

    return rows.map((r) => ({
      code: String(r.code),
      // El neto, no el bruto: la comisión ya la descontó el procesador.
      amount: this.num(r.netAmount),
      date: this.toISODate(r.settlementDate as Date),
      method: String(r.method),
    }));
  }

  /** Gastos con vencimiento en el período. */
  private async getUpcomingExpenses(from: string, to: string) {
    const rows = await this.prisma.tenantQueryRaw<Array<Record<string, unknown>>>(
      `
      SELECT e.code, e.concept, e.total, e."dueDate", s.name AS supplier
      FROM expenses e
      LEFT JOIN suppliers s ON s.id = e."supplierId"
      WHERE e."clubId" = current_club_id()
        AND e."deletedAt" IS NULL
        AND e.status IN ('PENDING','PARTIALLY_PAID')
        AND e."dueDate" IS NOT NULL
        AND e."dueDate" >= $1::date
        AND e."dueDate" <= $2::date
      ORDER BY e."dueDate"
      `,
      from,
      to,
    );

    return rows.map((r) => ({
      code: String(r.code),
      concept: String(r.concept),
      amount: this.num(r.total),
      date: this.toISODate(r.dueDate as Date),
      supplier: r.supplier ? String(r.supplier) : null,
    }));
  }

  private buildAlerts(
    days: CashFlowDay[],
    opening: number,
  ): CashFlowProjection['alerts'] {
    const alerts: CashFlowProjection['alerts'] = [];

    const firstNegative = days.find((d) => d.isNegative);
    if (firstNegative) {
      alerts.push({
        severity: 'HIGH',
        message:
          `El saldo proyectado queda en ${this.money(firstNegative.runningBalance)} ` +
          `el ${firstNegative.date}. Revisá los vencimientos de esa semana.`,
      });
    }

    // Un día con una salida grande relativa al saldo actual merece aviso
    // aunque no llegue a negativo.
    for (const d of days) {
      if (d.outflow > 0 && opening > 0 && d.outflow > opening * 0.5 && !d.isNegative) {
        alerts.push({
          severity: 'MEDIUM',
          message:
            `El ${d.date} vencen ${this.money(d.outflow)}, más de la mitad de lo ` +
            'que tenés disponible hoy.',
        });
        break;
      }
    }

    const overdue = days[0];
    if (overdue && overdue.outflow > 0 && opening < overdue.outflow) {
      alerts.push({
        severity: 'HIGH',
        message: `Hoy vencen ${this.money(overdue.outflow)} y el disponible es ${this.money(opening)}.`,
      });
    }

    return alerts;
  }

  // -------------------------------------------------------------------------

  private todayISO(): string {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  }

  private addDays(iso: string, days: number): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) throw new BadRequestException(`Fecha inválida: ${iso}`);
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  private toISODate(d: Date): string {
    return new Date(d).toISOString().slice(0, 10);
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
