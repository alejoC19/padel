/**
 * Tests de la política de cancelación y reembolsos.
 *
 * A DIFERENCIA de verify-money.cjs (que REPLICA la lógica en paralelo y por
 * tanto puede quedar desincronizado del código real), esto importa las
 * funciones DE VERDAD. Si alguien cambia calculateRefund y rompe una regla,
 * este test falla — que es exactamente lo que un test debe hacer.
 */
import {
  DEFAULT_POLICY,
  parsePolicy,
  calculateRefund,
  calculateNoShowCharge,
} from '../../src/bookings/cancellation-policy';

const AT = (hoursFromNow: number, now = new Date('2026-01-15T12:00:00Z')) =>
  new Date(now.getTime() + hoursFromNow * 3_600_000);
const NOW = new Date('2026-01-15T12:00:00Z');

describe('calculateRefund — cancela el CLIENTE', () => {
  it('devuelve el 100% con más de 24h de antelación', () => {
    const r = calculateRefund(DEFAULT_POLICY, AT(48), 10000, 'CLIENT', NOW);
    expect(r.refundPercent).toBe(100);
    expect(r.refundAmount).toBe(10000);
    expect(r.cancellationFee).toBe(0);
  });

  it('aplica el tramo intermedio entre 12 y 24h', () => {
    const r = calculateRefund(DEFAULT_POLICY, AT(13), 10000, 'CLIENT', NOW);
    // DEFAULT_POLICY: 24h→100, 12h→50, 0h→0
    expect(r.refundPercent).toBe(50);
    expect(r.refundAmount).toBe(5000);
    expect(r.cancellationFee).toBe(5000);
  });

  it('no devuelve nada con menos del mínimo de antelación', () => {
    const r = calculateRefund(DEFAULT_POLICY, AT(2), 10000, 'CLIENT', NOW);
    expect(r.refundPercent).toBe(0);
    expect(r.refundAmount).toBe(0);
    expect(r.cancellationFee).toBe(10000);
  });

  it('usa el borde exacto de 24h de forma inclusiva', () => {
    const r = calculateRefund(DEFAULT_POLICY, AT(24), 10000, 'CLIENT', NOW);
    expect(r.refundPercent).toBe(100);
  });

  it('redondea a dos decimales', () => {
    const r = calculateRefund(DEFAULT_POLICY, AT(13), 3333.33, 'CLIENT', NOW);
    expect(r.refundAmount).toBe(1666.67);
    expect(Number.isInteger(r.refundAmount * 100)).toBe(true);
  });
});

describe('calculateRefund — cancela el CLUB', () => {
  it('devuelve todo sin importar la antelación', () => {
    // Aunque falten 2h, si cancela el club el cliente recupera todo.
    const r = calculateRefund(DEFAULT_POLICY, AT(2), 10000, 'CLUB', NOW);
    expect(r.refundAmount).toBe(10000);
    expect(r.cancellationFee).toBe(0);
    expect(r.tierApplied).toMatch(/club/i);
  });
});

describe('calculateNoShowCharge', () => {
  it('cobra el 100% si no había pagado nada', () => {
    const r = calculateNoShowCharge(DEFAULT_POLICY, 8000, 0);
    expect(r.chargeAmount).toBe(8000);
    expect(r.pendingAmount).toBe(8000);
  });

  it('descuenta lo ya pagado del pendiente', () => {
    const r = calculateNoShowCharge(DEFAULT_POLICY, 8000, 3000);
    expect(r.chargeAmount).toBe(8000);
    expect(r.pendingAmount).toBe(5000);
  });

  it('nunca deja pendiente negativo si pagó de más', () => {
    const r = calculateNoShowCharge(DEFAULT_POLICY, 8000, 10000);
    expect(r.pendingAmount).toBe(0);
  });
});

describe('parsePolicy', () => {
  it('cae al default con entrada inválida', () => {
    expect(parsePolicy(null)).toEqual(DEFAULT_POLICY);
    expect(parsePolicy('basura')).toEqual(DEFAULT_POLICY);
    expect(parsePolicy(42)).toEqual(DEFAULT_POLICY);
  });

  it('respeta una política válida provista (anidada en cancellationPolicy)', () => {
    // parsePolicy lee la política desde la clave `cancellationPolicy` del
    // objeto de settings del club, no el objeto plano.
    const settings = {
      cancellationPolicy: {
        tiers: [
          { hoursBefore: 48, refundPercent: 100 },
          { hoursBefore: 0, refundPercent: 0 },
        ],
        noShowChargePercent: 50,
        clubCancelRefundPercent: 100,
      },
    };
    const p = parsePolicy(settings);
    expect(p.noShowChargePercent).toBe(50);
    expect(p.tiers[0].hoursBefore).toBe(48);
  });

  it('ordena los tramos por antelación descendente', () => {
    const settings = {
      cancellationPolicy: {
        tiers: [
          { hoursBefore: 0, refundPercent: 0 },
          { hoursBefore: 48, refundPercent: 100 },
          { hoursBefore: 12, refundPercent: 50 },
        ],
        noShowChargePercent: 100,
        clubCancelRefundPercent: 100,
      },
    };
    const p = parsePolicy(settings);
    // El primer tramo debe ser el de mayor antelación.
    expect(p.tiers[0].hoursBefore).toBe(48);
  });
});
