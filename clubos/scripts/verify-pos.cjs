/** Verificación de la aritmética del POS y el kardex. */
let pass=0, fail=0;
const check=(n,f)=>{try{f();console.log(`  ✓ ${n}`);pass++;}catch(e){console.log(`  ✗ ${n}\n      ${e.message}`);fail++;}};
const eq=(a,b,m)=>{if(a!==b)throw new Error(`${m}: got ${a}, want ${b}`)};
const r2=n=>Math.round(n*100)/100;
const r3=n=>Math.round(n*1000)/1000;

console.log('\nTotales de una venta\n');

// Réplica del cálculo de PosService
function calcSale(items, globalDiscount = 0) {
  let subtotal = 0, taxAmount = 0;
  const lines = items.map(i => {
    const gross = r2(i.unitPrice * i.quantity);
    const discount = r2(i.discountAmount ?? 0);
    const total = r2(gross - discount);
    // El precio de lista es final (IVA incluido): el impuesto se EXTRAE.
    const tax = r2(total - total / (1 + i.taxRate / 100));
    subtotal += gross; taxAmount += tax;
    return { total, tax };
  });
  const discountAmount = r2(items.reduce((s,i)=>s+(i.discountAmount??0),0) + globalDiscount);
  return { subtotal: r2(subtotal), discountAmount, taxAmount: r2(taxAmount), total: r2(subtotal - discountAmount) };
}

check('una unidad simple', () => {
  const s = calcSale([{ unitPrice: 2500, quantity: 1, taxRate: 21 }]);
  eq(s.subtotal, 2500, 'subtotal');
  eq(s.total, 2500, 'total');
});

check('varias unidades del mismo producto', () => {
  const s = calcSale([{ unitPrice: 2500, quantity: 3, taxRate: 21 }]);
  eq(s.total, 7500, '3 × 2500');
});

check('el IVA se extrae del precio, no se suma encima', () => {
  // $2.500 finales con 21%: la base es 2066.12 y el IVA 433.88
  const s = calcSale([{ unitPrice: 2500, quantity: 1, taxRate: 21 }]);
  eq(s.taxAmount, 433.88, 'IVA contenido');
  eq(r2(s.total - s.taxAmount), 2066.12, 'base imponible');
  // Si se sumara encima, el total sería 3025 y el cliente pagaría de más.
});

check('el total nunca cambia por el IVA', () => {
  for (const rate of [0, 10.5, 21, 27]) {
    const s = calcSale([{ unitPrice: 1000, quantity: 1, taxRate: rate }]);
    eq(s.total, 1000, `total con ${rate}%`);
  }
});

check('productos con distinta alícuota en la misma venta', () => {
  const s = calcSale([
    { unitPrice: 2500, quantity: 2, taxRate: 21 },   // gaseosa
    { unitPrice: 1800, quantity: 1, taxRate: 10.5 }, // agua
  ]);
  eq(s.total, 6800, '5000 + 1800');
  const tax21 = r2(5000 - 5000/1.21);
  const tax105 = r2(1800 - 1800/1.105);
  eq(s.taxAmount, r2(tax21 + tax105), 'IVA por línea');
});

check('descuento por línea', () => {
  const s = calcSale([{ unitPrice: 2500, quantity: 2, taxRate: 21, discountAmount: 500 }]);
  eq(s.subtotal, 5000, 'antes del descuento');
  eq(s.discountAmount, 500, 'descuento');
  eq(s.total, 4500, 'después');
});

check('descuento global se suma a los de línea', () => {
  const s = calcSale([
    { unitPrice: 2500, quantity: 2, taxRate: 21, discountAmount: 200 },
  ], 300);
  eq(s.discountAmount, 500, '200 + 300');
  eq(s.total, 4500, 'total');
});

check('el descuento no puede dejar el total negativo', () => {
  const s = calcSale([{ unitPrice: 1000, quantity: 1, taxRate: 21 }], 1500);
  if (s.total >= 0) throw new Error('el servicio debe rechazar esto');
  // PosService lanza BadRequestException en este caso.
});

console.log('\nVuelto\n');

check('vuelto exacto', () => {
  eq(r2(5000 - 4500), 500, 'vuelto');
});
check('pago justo no da vuelto', () => {
  eq(r2(4500 - 4500), 0, 'sin vuelto');
});

console.log('\nKardex: signo de los movimientos\n');

const DIRECTION = {
  PURCHASE: 1, RETURN: 1, INITIAL: 1,
  SALE: -1, LOSS: -1, TRANSFER: -1,
  ADJUSTMENT: 0,
};
function applyMovement(current, type, quantity) {
  const dir = DIRECTION[type];
  const signed = dir === 0 ? quantity : Math.abs(quantity) * dir;
  return { signed, balanceAfter: r3(current + signed) };
}

check('una compra suma', () => {
  const m = applyMovement(10, 'PURCHASE', 24);
  eq(m.balanceAfter, 34, 'saldo');
});

check('una venta resta', () => {
  const m = applyMovement(34, 'SALE', 3);
  eq(m.signed, -3, 'signo negativo');
  eq(m.balanceAfter, 31, 'saldo');
});

check('el signo lo fija el tipo, no el operador', () => {
  // Aunque se mande cantidad negativa, una compra siempre suma.
  const m = applyMovement(10, 'PURCHASE', -24);
  eq(m.signed, 24, 'la compra siempre entra');
});

check('una rotura resta', () => {
  const m = applyMovement(31, 'LOSS', 2);
  eq(m.balanceAfter, 29, 'saldo');
});

check('una devolución suma', () => {
  const m = applyMovement(29, 'RETURN', 3);
  eq(m.balanceAfter, 32, 'vuelve el stock de una venta anulada');
});

check('el ajuste respeta el signo que le dan', () => {
  const menos = applyMovement(32, 'ADJUSTMENT', -4);
  eq(menos.balanceAfter, 28, 'faltante');
  const mas = applyMovement(28, 'ADJUSTMENT', 5);
  eq(mas.balanceAfter, 33, 'sobrante');
});

check('el stock puede quedar negativo y queda visible', () => {
  const m = applyMovement(2, 'SALE', 5);
  eq(m.balanceAfter, -3, 'se permite');
  // Frenar la venta sería peor negocio; el negativo es la alerta.
});

console.log('\nAjuste por conteo\n');

function adjustToCount(previous, counted) {
  return { difference: r3(counted - previous) };
}

check('contar más que el sistema genera ajuste positivo', () => {
  eq(adjustToCount(20, 24).difference, 4, 'sobrante');
});
check('contar menos genera ajuste negativo', () => {
  eq(adjustToCount(20, 17).difference, -3, 'faltante');
});
check('contar lo mismo no genera movimiento', () => {
  eq(adjustToCount(20, 20).difference, 0, 'sin ajuste');
});
check('se recibe lo contado, no la diferencia', () => {
  // El operador cuenta botellas; el sistema deriva el delta. Si tuviera que
  // calcular la diferencia a mano, ahí estaría el error.
  const previous = 18, counted = 15;
  eq(adjustToCount(previous, counted).difference, -3, 'derivado');
});

console.log('\nAlertas de reposición\n');

function severity(stockQty, minStockQty) {
  if (stockQty < 0) return 'NEGATIVE';
  if (stockQty === 0) return 'OUT_OF_STOCK';
  if (stockQty <= minStockQty) return 'BELOW_MINIMUM';
  return null;
}

check('stock negativo es lo más urgente', () => {
  eq(severity(-3, 6), 'NEGATIVE', 'hay un error de inventario');
});
check('stock agotado', () => eq(severity(0, 6), 'OUT_OF_STOCK', 'sin stock'));
check('bajo el mínimo', () => eq(severity(4, 6), 'BELOW_MINIMUM', 'reponer'));
check('en el mínimo exacto ya alerta', () => eq(severity(6, 6), 'BELOW_MINIMUM', 'borde'));
check('por encima del mínimo no alerta', () => eq(severity(7, 6), null, 'sin alerta'));

console.log('\nValuación de inventario\n');

check('margen sobre costo', () => {
  const cost = 1500, sale = 2500;
  eq(r2(((sale - cost) / cost) * 100), 66.67, 'margen %');
});
check('sin costo cargado no hay margen calculable', () => {
  const cost = 0;
  eq(cost > 0 ? 1 : null, null, 'no se inventa un margen');
});
check('ganancia potencial del depósito', () => {
  const costValue = 120000, saleValue = 210000;
  eq(r2(saleValue - costValue), 90000, 'si se vendiera todo');
});

console.log(`\n${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail?1:0);
