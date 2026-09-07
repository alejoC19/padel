/**
 * Políticas de cancelación.
 *
 * Se guardan en `Club.settings.cancellationPolicy` como JSON en vez de
 * tabla propia: son 3-4 tramos que el club define una vez y casi nunca
 * cambia. Una tabla agregaría un join a cada cancelación sin ganancia.
 *
 * Forma esperada:
 *   {
 *     "tiers": [
 *       { "hoursBefore": 24, "refundPercent": 100 },
 *       { "hoursBefore": 12, "refundPercent": 50 },
 *       { "hoursBefore": 0,  "refundPercent": 0 }
 *     ],
 *     "noShowChargePercent": 100,
 *     "clubCancelRefundPercent": 100
 *   }
 */

export interface CancellationTier {
  hoursBefore: number;
  refundPercent: number;
}

export interface CancellationPolicy {
  tiers: CancellationTier[];
  noShowChargePercent: number;
  clubCancelRefundPercent: number;
}

export const DEFAULT_POLICY: CancellationPolicy = {
  tiers: [
    { hoursBefore: 24, refundPercent: 100 },
    { hoursBefore: 12, refundPercent: 50 },
    { hoursBefore: 0, refundPercent: 0 },
  ],
  noShowChargePercent: 100,
  clubCancelRefundPercent: 100,
};

export interface RefundCalculation {
  refundPercent: number;
  refundAmount: number;
  cancellationFee: number;
  hoursBefore: number;
  tierApplied: string;
}

export function parsePolicy(raw: unknown): CancellationPolicy {
  if (!raw || typeof raw !== 'object') return DEFAULT_POLICY;

  const p = (raw as Record<string, unknown>).cancellationPolicy;
  if (!p || typeof p !== 'object') return DEFAULT_POLICY;

  const obj = p as Record<string, unknown>;
  const tiers = Array.isArray(obj.tiers)
    ? (obj.tiers as CancellationTier[])
        .filter(
          (t) =>
            typeof t?.hoursBefore === 'number' &&
            typeof t?.refundPercent === 'number' &&
            t.refundPercent >= 0 &&
            t.refundPercent <= 100,
        )
        // Descendente por antelación: el primero que califica es el mejor
        // tramo al que el cliente llega.
        .sort((a, b) => b.hoursBefore - a.hoursBefore)
    : DEFAULT_POLICY.tiers;

  return {
    tiers: tiers.length > 0 ? tiers : DEFAULT_POLICY.tiers,
    noShowChargePercent: clamp(
      obj.noShowChargePercent,
      DEFAULT_POLICY.noShowChargePercent,
    ),
    clubCancelRefundPercent: clamp(
      obj.clubCancelRefundPercent,
      DEFAULT_POLICY.clubCancelRefundPercent,
    ),
  };
}

/**
 * Calcula la devolución de una cancelación.
 *
 * `paidAmount` y no `totalPrice`: no se puede devolver lo que no se cobró.
 * Si el cliente pagó una seña de 5000 sobre 18000 y cancela con 100% de
 * devolución, se le devuelven 5000, no 18000.
 */
export function calculateRefund(
  policy: CancellationPolicy,
  startsAt: Date,
  paidAmount: number,
  cancelledBy: 'CLIENT' | 'CLUB',
  now: Date = new Date(),
): RefundCalculation {
  const hoursBefore = (startsAt.getTime() - now.getTime()) / 3_600_000;

  // Si cancela el club, el cliente no debe perder plata por una decisión
  // que no tomó. La antelación es irrelevante.
  if (cancelledBy === 'CLUB') {
    const pct = policy.clubCancelRefundPercent;
    const refund = round(paidAmount * (pct / 100));
    return {
      refundPercent: pct,
      refundAmount: refund,
      cancellationFee: round(paidAmount - refund),
      hoursBefore: round(hoursBefore),
      tierApplied: 'Cancelación del club',
    };
  }

  const tier =
    policy.tiers.find((t) => hoursBefore >= t.hoursBefore) ??
    policy.tiers[policy.tiers.length - 1];

  const refund = round(paidAmount * (tier.refundPercent / 100));

  return {
    refundPercent: tier.refundPercent,
    refundAmount: refund,
    cancellationFee: round(paidAmount - refund),
    hoursBefore: round(hoursBefore),
    tierApplied:
      tier.hoursBefore > 0
        ? `Más de ${tier.hoursBefore}hs de antelación`
        : 'Menos del mínimo de antelación',
  };
}

/** Cargo por ausencia sin aviso. */
export function calculateNoShowCharge(
  policy: CancellationPolicy,
  totalPrice: number,
  paidAmount: number,
): { chargeAmount: number; pendingAmount: number } {
  const charge = round(totalPrice * (policy.noShowChargePercent / 100));
  return {
    chargeAmount: charge,
    // Lo que falta cobrar si ya había pagado parte.
    pendingAmount: round(Math.max(0, charge - paidAmount)),
  };
}

function clamp(v: unknown, fallback: number): number {
  return typeof v === 'number' && v >= 0 && v <= 100 ? v : fallback;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
