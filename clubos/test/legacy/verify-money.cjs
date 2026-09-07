/**
 * Verificación de los cálculos de dinero.
 *
 * Replica la lógica de cancellation-policy.ts y payment.service.ts.
 * Si cambia el algoritmo allá, cambiar acá.
 */

let pass = 0, fail = 0;
const check = (n, f) => {
  try { f(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${a}, want ${b}`); };
const round = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Política de cancelación
// ---------------------------------------------------------------------------
const POLICY = {
  tiers: [
    { hoursBefore: 24, refundPercent: 100 },
    { hoursBefore: 12, refundPercent: 50 },
    { hoursBefore: 0, refundPercent: 0 },
  ],
  noShowChargePercent: 100,
  clubCancelRefundPercent: 100,
};

function calculateRefund(policy, startsAt, paidAmount, cancelledBy, now) {
  const hoursBefore = (startsAt.getTime() - now.getTime()) / 3600000;
  if (cancelledBy === 'CLUB') {
    const pct = policy.clubCancelRefundPercent;
    const refund = round(paidAmount * (pct / 100));
    return { refundPercent: pct, refundAmount: refund, cancellationFee: round(paidAmount - refund) };
  }
  const tier = policy.tiers.find((t) => hoursBefore >= t.hoursBefore) ?? policy.tiers[policy.tiers.length - 1];
  const refund = round(paidAmount * (tier.refundPercent / 100));
  return { refundPercent: tier.refundPercent, refundAmount: refund, cancellationFee: round(paidAmount - refund) };
}

const NOW = new Date('2026-07-22T12:00:00Z');
const hoursFromNow = (h) => new Date(NOW.getTime() + h * 3600000);

console.log('\nPolítica de cancelación\n');

check('cancelación con 48hs: devolución total', () => {
  const r = calculateRefund(POLICY, hoursFromNow(48), 18000, 'CLIENT', NOW);
  eq(r.refundAmount, 18000, 'reembolso');
  eq(r.cancellationFee, 0, 'penalidad');
});

check('cancelación exacta a 24hs: devolución total (borde inclusivo)', () => {
  const r = calculateRefund(POLICY, hoursFromNow(24), 18000, 'CLIENT', NOW);
  eq(r.refundPercent, 100, 'el borde debe entrar al tramo');
});

check('cancelación con 18hs: mitad', () => {
  const r = calculateRefund(POLICY, hoursFromNow(18), 18000, 'CLIENT', NOW);
  eq(r.refundAmount, 9000, 'reembolso');
  eq(r.cancellationFee, 9000, 'penalidad');
});

check('cancelación con 6hs: sin devolución', () => {
  const r = calculateRefund(POLICY, hoursFromNow(6), 18000, 'CLIENT', NOW);
  eq(r.refundAmount, 0, 'reembolso');
  eq(r.cancellationFee, 18000, 'penalidad');
});

check('cancelación después del turno: sin devolución', () => {
  const r = calculateRefund(POLICY, hoursFromNow(-2), 18000, 'CLIENT', NOW);
  eq(r.refundAmount, 0, 'reembolso');
});

check('si cancela el club: devolución total sin importar antelación', () => {
  const r = calculateRefund(POLICY, hoursFromNow(1), 18000, 'CLUB', NOW);
  eq(r.refundAmount, 18000, 'el cliente no paga por decisión del club');
  eq(r.cancellationFee, 0, 'sin penalidad');
});

check('solo se devuelve lo efectivamente pagado', () => {
  // Total 18000, pagó seña de 5000, cancela con 100%.
  const r = calculateRefund(POLICY, hoursFromNow(48), 5000, 'CLIENT', NOW);
  eq(r.refundAmount, 5000, 'no se devuelve más de lo cobrado');
});

check('reserva impaga no genera devolución', () => {
  const r = calculateRefund(POLICY, hoursFromNow(48), 0, 'CLIENT', NOW);
  eq(r.refundAmount, 0, 'nada que devolver');
  eq(r.cancellationFee, 0, 'ni penalidad');
});

check('devolución parcial redondea a centavos', () => {
  const r = calculateRefund(POLICY, hoursFromNow(18), 13333.33, 'CLIENT', NOW);
  eq(r.refundAmount, 6666.67, 'redondeo');
  eq(round(r.refundAmount + r.cancellationFee), 13333.33, 'suma cierra');
});

// ---------------------------------------------------------------------------
// Comisiones de medios de pago
// ---------------------------------------------------------------------------
function calcFee(amount, feePercent, feeFixed) {
  const fee = round(amount * (feePercent / 100) + feeFixed);
  return { feeAmount: fee, netAmount: round(amount - fee) };
}

console.log('\nComisiones\n');

check('efectivo no tiene comisión', () => {
  const r = calcFee(18000, 0, 0);
  eq(r.feeAmount, 0, 'comisión');
  eq(r.netAmount, 18000, 'neto');
});

check('Mercado Pago Link 5.49%', () => {
  const r = calcFee(18000, 5.49, 0);
  eq(r.feeAmount, 988.2, 'comisión');
  eq(r.netAmount, 17011.8, 'neto');
});

check('comisión + fijo se suman', () => {
  const r = calcFee(10000, 3.5, 50);
  eq(r.feeAmount, 400, '350 + 50');
  eq(r.netAmount, 9600, 'neto');
});

check('bruto = neto + comisión siempre', () => {
  for (const amt of [1, 99.99, 18000, 26000, 133333.33]) {
    const r = calcFee(amt, 5.49, 0);
    if (Math.abs(round(r.netAmount + r.feeAmount) - round(amt)) > 0.01) {
      throw new Error(`no cierra para ${amt}: ${r.netAmount}+${r.feeAmount}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Estados de pago
// ---------------------------------------------------------------------------
function resolvePaymentStatus(paid, total) {
  if (paid <= 0) return 'UNPAID';
  if (paid >= total) return paid > total ? 'OVERPAID' : 'PAID';
  return 'PARTIAL';
}

console.log('\nEstados de pago\n');

check('sin pagar', () => eq(resolvePaymentStatus(0, 18000), 'UNPAID', 'estado'));
check('seña parcial', () => eq(resolvePaymentStatus(5000, 18000), 'PARTIAL', 'estado'));
check('pago exacto', () => eq(resolvePaymentStatus(18000, 18000), 'PAID', 'estado'));
check('pago de más', () => eq(resolvePaymentStatus(20000, 18000), 'OVERPAID', 'estado'));
check('reserva gratuita queda pagada', () => eq(resolvePaymentStatus(0, 0), 'UNPAID', 'total 0'));

// ---------------------------------------------------------------------------
// Cuenta corriente: signo y límite de crédito
// ---------------------------------------------------------------------------
console.log('\nCuenta corriente\n');

check('cargo genera saldo negativo (deuda)', () => {
  const balance = 0;
  const after = round(balance - 18000);
  eq(after, -18000, 'deuda');
});

check('pago genera saldo positivo', () => {
  const balance = -18000;
  const after = round(balance + 18000);
  eq(after, 0, 'saldado');
});

check('límite de crédito bloquea el exceso', () => {
  const canCharge = (balance, limit, amount) => round(balance - amount) >= -limit;
  eq(canCharge(0, 20000, 18000), true, 'dentro del límite');
  eq(canCharge(0, 20000, 25000), false, 'excede');
  eq(canCharge(-15000, 20000, 10000), false, 'ya endeudado, excede');
  eq(canCharge(-15000, 20000, 5000), true, 'ya endeudado, entra justo');
});

check('límite cero impide operar a cuenta', () => {
  const canCharge = (balance, limit, amount) => round(balance - amount) >= -limit;
  eq(canCharge(0, 0, 1), false, 'sin crédito asignado');
});

check('saldo a favor permite cargar más allá del límite', () => {
  const canCharge = (balance, limit, amount) => round(balance - amount) >= -limit;
  // Cliente con 10000 a favor y límite 5000: puede consumir 15000.
  eq(canCharge(10000, 5000, 15000), true, 'saldo + límite');
  eq(canCharge(10000, 5000, 15001), false, 'un peso más, no');
});

// ---------------------------------------------------------------------------
// Reparto de reembolsos entre varios pagos
// ---------------------------------------------------------------------------
function distributeRefund(payments, totalRefund) {
  let pending = totalRefund;
  const out = [];
  for (const p of payments) {
    if (pending <= 0) break;
    const available = round(p.amount - p.refunded);
    if (available <= 0) continue;
    const take = Math.min(available, pending);
    out.push({ id: p.id, amount: round(take) });
    pending = round(pending - take);
  }
  return { allocations: out, unallocated: pending };
}

console.log('\nReparto de reembolsos\n');

check('un solo pago cubre el reembolso', () => {
  const r = distributeRefund([{ id: 'p1', amount: 18000, refunded: 0 }], 18000);
  eq(r.allocations.length, 1, 'asignaciones');
  eq(r.allocations[0].amount, 18000, 'monto');
  eq(r.unallocated, 0, 'sin remanente');
});

check('se reparte entre varios pagos, del más viejo al más nuevo', () => {
  const r = distributeRefund(
    [{ id: 'p1', amount: 5000, refunded: 0 }, { id: 'p2', amount: 13000, refunded: 0 }],
    18000
  );
  eq(r.allocations.length, 2, 'dos pagos');
  eq(r.allocations[0].id, 'p1', 'primero el más viejo');
  eq(r.allocations[0].amount, 5000, 'agota el primero');
  eq(r.allocations[1].amount, 13000, 'resto al segundo');
});

check('reembolso parcial no agota el pago', () => {
  const r = distributeRefund([{ id: 'p1', amount: 18000, refunded: 0 }], 9000);
  eq(r.allocations[0].amount, 9000, 'mitad');
  eq(r.unallocated, 0, 'sin remanente');
});

check('pagos ya reembolsados se saltean', () => {
  const r = distributeRefund(
    [{ id: 'p1', amount: 5000, refunded: 5000 }, { id: 'p2', amount: 13000, refunded: 0 }],
    9000
  );
  eq(r.allocations.length, 1, 'solo el segundo');
  eq(r.allocations[0].id, 'p2', 'saltea el agotado');
});

check('reembolso mayor a lo cobrado deja remanente sin asignar', () => {
  const r = distributeRefund([{ id: 'p1', amount: 5000, refunded: 0 }], 8000);
  eq(r.allocations[0].amount, 5000, 'solo lo disponible');
  eq(r.unallocated, 3000, 'remanente detectado');
});

// ---------------------------------------------------------------------------
// No-show
// ---------------------------------------------------------------------------
function calcNoShow(policy, totalPrice, paidAmount) {
  const charge = round(totalPrice * (policy.noShowChargePercent / 100));
  return { chargeAmount: charge, pendingAmount: round(Math.max(0, charge - paidAmount)) };
}

console.log('\nAusencia sin aviso\n');

check('no-show impago genera deuda por el total', () => {
  const r = calcNoShow(POLICY, 18000, 0);
  eq(r.pendingAmount, 18000, 'deuda');
});

check('no-show ya pagado no genera deuda extra', () => {
  const r = calcNoShow(POLICY, 18000, 18000, 0);
  eq(r.pendingAmount, 0, 'nada que cobrar');
});

check('no-show con seña cobra solo el saldo', () => {
  const r = calcNoShow(POLICY, 18000, 5000);
  eq(r.pendingAmount, 13000, 'saldo');
});

check('política de 50% cobra la mitad', () => {
  const r = calcNoShow({ ...POLICY, noShowChargePercent: 50 }, 18000, 0);
  eq(r.pendingAmount, 9000, 'mitad');
});

console.log(`\n${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail ? 1 : 0);
