/**
 * Cálculo del estado de una caja.
 *
 * ---------------------------------------------------------------------------
 * LA DISTINCIÓN QUE IMPORTA
 * ---------------------------------------------------------------------------
 * Una caja registra movimientos de TODOS los medios de pago, pero el arqueo
 * cuenta solo billetes. Si el esperado incluyera los cobros con tarjeta, el
 * recepcionista contaría 50.000 en efectivo contra un esperado de 180.000 y
 * la caja daría un faltante de 130.000 que no existe.
 *
 * De ahí las dos cifras:
 *
 *   expectedCash  = apertura + entradas EN EFECTIVO − salidas EN EFECTIVO
 *                   ↑ esto es lo que se compara contra el conteo físico
 *
 *   totalByMethod = desglose completo por medio de pago
 *                   ↑ esto es lo que se concilia con el banco / Mercado Pago
 *
 * `affectsCashCount` en PaymentMethod es lo que discrimina uno de otro.
 * ---------------------------------------------------------------------------
 */

export interface MovementRow {
  direction: 'IN' | 'OUT';
  amount: number;
  type: string;
  affectsCashCount: boolean;
  methodCode: string | null;
  methodName: string | null;
}

export interface MethodBreakdown {
  code: string;
  name: string;
  inflow: number;
  outflow: number;
  net: number;
  affectsCashCount: boolean;
}

export interface TypeBreakdown {
  type: string;
  inflow: number;
  outflow: number;
  count: number;
}

export interface CashBalance {
  openingAmount: number;
  /** Solo efectivo: lo que debería haber físicamente en el cajón. */
  expectedCash: number;
  cashInflow: number;
  cashOutflow: number;
  /** Todos los medios, incluido el efectivo. */
  totalInflow: number;
  totalOutflow: number;
  netTotal: number;
  byMethod: MethodBreakdown[];
  byType: TypeBreakdown[];
  movementCount: number;
}

export function calculateBalance(
  openingAmount: number,
  movements: MovementRow[],
): CashBalance {
  let cashIn = 0;
  let cashOut = 0;
  let totalIn = 0;
  let totalOut = 0;

  const methods = new Map<string, MethodBreakdown>();
  const types = new Map<string, TypeBreakdown>();

  for (const m of movements) {
    const amt = round(m.amount);
    const isIn = m.direction === 'IN';

    if (isIn) totalIn += amt;
    else totalOut += amt;

    if (m.affectsCashCount) {
      if (isIn) cashIn += amt;
      else cashOut += amt;
    }

    // Movimientos sin medio de pago (ajustes, retiros a banco) se agrupan
    // bajo una clave propia para que el desglose siga sumando el total.
    const code = m.methodCode ?? '__NONE__';
    const name = m.methodName ?? 'Sin medio asignado';
    const mb = methods.get(code) ?? {
      code,
      name,
      inflow: 0,
      outflow: 0,
      net: 0,
      affectsCashCount: m.affectsCashCount,
    };
    if (isIn) mb.inflow = round(mb.inflow + amt);
    else mb.outflow = round(mb.outflow + amt);
    mb.net = round(mb.inflow - mb.outflow);
    methods.set(code, mb);

    const tb = types.get(m.type) ?? { type: m.type, inflow: 0, outflow: 0, count: 0 };
    if (isIn) tb.inflow = round(tb.inflow + amt);
    else tb.outflow = round(tb.outflow + amt);
    tb.count++;
    types.set(m.type, tb);
  }

  return {
    openingAmount: round(openingAmount),
    expectedCash: round(openingAmount + cashIn - cashOut),
    cashInflow: round(cashIn),
    cashOutflow: round(cashOut),
    totalInflow: round(totalIn),
    totalOutflow: round(totalOut),
    netTotal: round(totalIn - totalOut),
    byMethod: [...methods.values()].sort((a, b) => b.net - a.net),
    byType: [...types.values()].sort((a, b) => b.inflow - a.inflow),
    movementCount: movements.length,
  };
}

/**
 * Diferencia del arqueo.
 *
 * Negativa = falta plata. Positiva = sobra.
 *
 * El signo importa operativamente: un faltante puede ser un vuelto mal dado
 * o un robo; un sobrante suele ser un cobro no registrado, que es un
 * problema distinto (y contablemente peor, porque significa que hay ventas
 * sin asentar).
 */
export function calculateDifference(
  expectedCash: number,
  countedCash: number,
): { difference: number; kind: 'EXACT' | 'SHORTAGE' | 'SURPLUS' } {
  const diff = round(countedCash - expectedCash);
  return {
    difference: diff,
    kind: diff === 0 ? 'EXACT' : diff < 0 ? 'SHORTAGE' : 'SURPLUS',
  };
}

/**
 * Conteo por denominación (billetes y monedas argentinos).
 *
 * Contar por denominación en vez de tipear un total reduce el error humano
 * y deja registro de la composición del cajón, útil cuando aparece una
 * diferencia y hay que reconstruir qué pasó.
 */
export const ARS_DENOMINATIONS = [
  20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10,
] as const;

export function sumDenominations(counts: Record<string, number>): number {
  let total = 0;
  for (const [denom, qty] of Object.entries(counts)) {
    const d = Number(denom);
    const q = Number(qty);
    if (!Number.isFinite(d) || !Number.isFinite(q) || q < 0) continue;
    total += d * q;
  }
  return round(total);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
