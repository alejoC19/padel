/** Verificación del cálculo de caja. */
require('child_process').execSync('npx tsc src/cash/cash-balance.ts --outDir /tmp/cashjs --target ES2022 --module commonjs --skipLibCheck', {stdio:'inherit'});
const C = require('/tmp/cashjs/cash-balance.js');

let pass=0, fail=0;
const check=(n,f)=>{try{f();console.log(`  ✓ ${n}`);pass++;}catch(e){console.log(`  ✗ ${n}\n      ${e.message}`);fail++;}};
const eq=(a,b,m)=>{if(a!==b)throw new Error(`${m}: got ${a}, want ${b}`);};

const cash = (dir, amt, type='BOOKING_PAYMENT') => ({direction:dir, amount:amt, type, affectsCashCount:true, methodCode:'CASH', methodName:'Efectivo'});
const card = (dir, amt, type='BOOKING_PAYMENT') => ({direction:dir, amount:amt, type, affectsCashCount:false, methodCode:'CREDIT', methodName:'Tarjeta'});

console.log('\nCálculo de saldo\n');

check('caja vacía: esperado = apertura', () => {
  const b = C.calculateBalance(10000, []);
  eq(b.expectedCash, 10000, 'esperado');
  eq(b.movementCount, 0, 'movimientos');
});

check('cobros en efectivo suman al esperado', () => {
  const b = C.calculateBalance(10000, [cash('IN',18000), cash('IN',22000)]);
  eq(b.expectedCash, 50000, '10000+18000+22000');
  eq(b.cashInflow, 40000, 'entradas');
});

check('gastos en efectivo restan', () => {
  const b = C.calculateBalance(10000, [cash('IN',18000), cash('OUT',5000,'EXPENSE')]);
  eq(b.expectedCash, 23000, '10000+18000-5000');
  eq(b.cashOutflow, 5000, 'salidas');
});

check('LA CLAVE: cobros con tarjeta NO afectan el efectivo esperado', () => {
  const b = C.calculateBalance(10000, [cash('IN',18000), card('IN',130000)]);
  eq(b.expectedCash, 28000, 'solo efectivo: 10000+18000');
  eq(b.totalInflow, 148000, 'total incluye tarjeta');
  // Sin esta distinción, el arqueo daría -130000 de faltante inexistente.
});

check('el desglose por medio suma el total', () => {
  const b = C.calculateBalance(0, [cash('IN',18000), card('IN',22000), cash('OUT',3000,'EXPENSE')]);
  const sumIn = b.byMethod.reduce((s,m)=>s+m.inflow,0);
  const sumOut = b.byMethod.reduce((s,m)=>s+m.outflow,0);
  eq(sumIn, b.totalInflow, 'entradas cuadran');
  eq(sumOut, b.totalOutflow, 'salidas cuadran');
});

check('movimientos sin medio de pago no rompen el desglose', () => {
  const adj = {direction:'OUT', amount:1000, type:'ADJUSTMENT', affectsCashCount:true, methodCode:null, methodName:null};
  const b = C.calculateBalance(10000, [cash('IN',5000), adj]);
  eq(b.expectedCash, 14000, 'esperado');
  const sumOut = b.byMethod.reduce((s,m)=>s+m.outflow,0);
  eq(sumOut, b.totalOutflow, 'cuadra igual');
  if (!b.byMethod.some(m=>m.code==='__NONE__')) throw new Error('falta grupo sin medio');
});

check('desglose por tipo cuenta operaciones', () => {
  const b = C.calculateBalance(0, [cash('IN',1000), cash('IN',2000), cash('OUT',500,'EXPENSE')]);
  const bp = b.byType.find(t=>t.type==='BOOKING_PAYMENT');
  eq(bp.count, 2, 'dos cobros');
  eq(bp.inflow, 3000, 'suma');
});

check('retiro deja el esperado en apertura', () => {
  // Caso real: se retira toda la recaudación al banco antes de cerrar.
  const b = C.calculateBalance(10000, [cash('IN',40000), cash('OUT',40000,'WITHDRAWAL')]);
  eq(b.expectedCash, 10000, 'queda el fondo fijo');
});

console.log('\nArqueo\n');

check('conteo exacto', () => {
  const d = C.calculateDifference(50000, 50000);
  eq(d.difference, 0, 'diferencia');
  eq(d.kind, 'EXACT', 'tipo');
});

check('faltante da negativo', () => {
  const d = C.calculateDifference(50000, 49500);
  eq(d.difference, -500, 'faltante');
  eq(d.kind, 'SHORTAGE', 'tipo');
});

check('sobrante da positivo', () => {
  const d = C.calculateDifference(50000, 50300);
  eq(d.difference, 300, 'sobrante');
  eq(d.kind, 'SURPLUS', 'tipo');
});

check('diferencia con centavos redondea bien', () => {
  const d = C.calculateDifference(50000.555, 50000.55);
  if (Math.abs(d.difference) > 0.01) throw new Error(`redondeo: ${d.difference}`);
});

console.log('\nConteo por denominación\n');

check('suma billetes correctamente', () => {
  // 2x20000 + 3x10000 + 5x1000 = 75000
  eq(C.sumDenominations({20000:2, 10000:3, 1000:5}), 75000, 'suma');
});

check('ignora cantidades negativas o inválidas', () => {
  eq(C.sumDenominations({10000:2, 1000:-5, 500:'abc'}), 20000, 'solo válidos');
});

check('conteo vacío da cero', () => {
  eq(C.sumDenominations({}), 0, 'vacío');
});

check('conteo por denominación coincide con total tipeado', () => {
  const counts = {20000:1, 10000:2, 2000:5, 500:4, 100:10};
  const total = 20000 + 20000 + 10000 + 2000 + 1000;
  eq(C.sumDenominations(counts), total, 'debe coincidir');
});

console.log('\nEscenario completo de un turno\n');

check('turno típico de recepción cuadra', () => {
  const movs = [
    cash('IN', 18000),                    // reserva efectivo
    card('IN', 26000),                    // reserva tarjeta
    cash('IN', 3500, 'PRODUCT_SALE'),     // bebidas
    cash('OUT', 2000, 'EXPENSE'),         // compra de hielo
    card('IN', 18000),                    // otra con tarjeta
    cash('IN', 22000),                    // reserva efectivo
    cash('OUT', 5000, 'WITHDRAWAL'),      // retiro parcial
  ];
  const b = C.calculateBalance(15000, movs);

  eq(b.expectedCash, 51500, '15000 + (18000+3500+22000) - (2000+5000)');
  eq(b.totalInflow, 87500, 'todo lo cobrado');
  eq(b.totalOutflow, 7000, 'todo lo pagado');

  // El arqueo cuenta 51500 en billetes => cuadra
  const d = C.calculateDifference(b.expectedCash, 51500);
  eq(d.kind, 'EXACT', 'debería cuadrar');

  // Si contara 44000 pensando que la tarjeta está en el cajón => faltante
  const wrong = C.calculateDifference(b.expectedCash, 44000);
  eq(wrong.kind, 'SHORTAGE', 'detecta el error');
});

console.log(`\n${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail?1:0);
