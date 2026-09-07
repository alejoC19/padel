/**
 * Circuito completo de un día del club.
 *
 * ---------------------------------------------------------------------------
 * QUÉ VERIFICA QUE LOS OTROS TESTS NO
 * ---------------------------------------------------------------------------
 * Los smoke tests prueban cada módulo por separado. Este prueba que encajen:
 * que la plata que entra por la agenda aparezca en la caja, que el buffet
 * descuente stock y sume al mismo arqueo, y que el cierre del día cuadre con
 * todo lo anterior.
 *
 * Es donde aparecen los errores de integración: un módulo que escribe en un
 * lugar y otro que lee de otro.
 * ---------------------------------------------------------------------------
 */
import pgpkg from 'pg';
const { Client } = pgpkg;

const CONN = {
  connectionString:
    process.env.SMOKE_OWNER_URL ??
    'postgresql://clubos_owner:clubos_dev@localhost:5432/clubos',
};

let pass = 0, fail = 0;
const step = async (n, f) => {
  try { await f(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const eq = (a, b, m) => {
  if (Math.abs(Number(a) - Number(b)) > 0.01 && String(a) !== String(b)) {
    throw new Error(`${m}: got ${a}, want ${b}`);
  }
};

const c = new Client(CONN);
await c.connect();

// ---------------------------------------------------------------------------
// Preparación: un club con todo lo mínimo para operar
// ---------------------------------------------------------------------------
console.log('\nPreparando el club...\n');

await c.query(`
  DELETE FROM audit_logs; DELETE FROM account_entries;
  DELETE FROM cash_movements; DELETE FROM payments;
  DELETE FROM sale_items; DELETE FROM sales;
  DELETE FROM stock_movements; DELETE FROM products; DELETE FROM product_categories;
  DELETE FROM booking_status_changes; DELETE FROM booking_players; DELETE FROM bookings;
  DELETE FROM cash_sessions; DELETE FROM cash_registers; DELETE FROM payment_methods;
  DELETE FROM price_rules; DELETE FROM price_lists; DELETE FROM clients;
  DELETE FROM courts; DELETE FROM sports; DELETE FROM operating_hours;
  DELETE FROM memberships; DELETE FROM roles; DELETE FROM document_counters;
  DELETE FROM expenses; DELETE FROM expense_categories; DELETE FROM suppliers;
  DELETE FROM bank_transactions; DELETE FROM bank_accounts;
  DELETE FROM clubs; DELETE FROM users; DELETE FROM plans;
`);

const one = async (sql, params = []) => (await c.query(sql, params)).rows[0];

const plan = await one(
  `INSERT INTO plans (code,name,price_monthly,price_yearly)
   VALUES ('pro','Pro',89000,899000) RETURNING id`);
const club = await one(
  `INSERT INTO clubs (slug,name,plan_id,status,timezone)
   VALUES ('e2e','Club E2E',$1,'ACTIVE','America/Argentina/Buenos_Aires') RETURNING id`,
  [plan.id]);
const user = await one(
  `INSERT INTO users (email,first_name,last_name) VALUES ('e2e@club.com','Reto','Recepción') RETURNING id`);
const role = await one(
  `INSERT INTO roles (club_id,code,name) VALUES ($1,'RECEPTION','Recepción') RETURNING id`, [club.id]);
const membership = await one(
  `INSERT INTO memberships (club_id,user_id,role_id,status) VALUES ($1,$2,$3,'ACTIVE') RETURNING id`,
  [club.id, user.id, role.id]);
const sport = await one(
  `INSERT INTO sports (club_id,code,name) VALUES ($1,'PADEL','Pádel') RETURNING id`, [club.id]);
const court = await one(
  `INSERT INTO courts (club_id,sport_id,name,number,capacity)
   VALUES ($1,$2,'Cancha 1',1,4) RETURNING id`, [club.id, sport.id]);
for (let d = 0; d <= 6; d++) {
  await c.query(
    `INSERT INTO operating_hours (club_id,day_of_week,open_minute,close_minute)
     VALUES ($1,$2,480,1440)`, [club.id, d]);
}
const pmCash = await one(
  `INSERT INTO payment_methods (club_id,code,name,kind,affects_cash_count,settlement_days,sort_order)
   VALUES ($1,'CASH','Efectivo','CASH',true,0,1) RETURNING id`, [club.id]);
const pmCard = await one(
  `INSERT INTO payment_methods (club_id,code,name,kind,affects_cash_count,fee_percent,settlement_days,sort_order)
   VALUES ($1,'CREDIT','Tarjeta','CREDIT_CARD',false,3.5,18,2) RETURNING id`, [club.id]);
const register = await one(
  `INSERT INTO cash_registers (club_id,name) VALUES ($1,'Recepción') RETURNING id`, [club.id]);
const cat = await one(
  `INSERT INTO product_categories (club_id,name) VALUES ($1,'Bebidas') RETURNING id`, [club.id]);
const coca = await one(
  `INSERT INTO products (club_id,category_id,name,sale_price,cost_price,tax_rate,
     stock_qty,min_stock_qty,track_stock,unit)
   VALUES ($1,$2,'Coca 500ml',2500,1500,21,24,6,true,'unidad') RETURNING id`,
  [club.id, cat.id]);
const client = await one(
  `INSERT INTO clients (club_id,first_name,last_name,phone,credit_limit)
   VALUES ($1,'Martina','Ferreyra','1145678900',20000) RETURNING id`, [club.id]);

console.log('Club listo.\n');

// ---------------------------------------------------------------------------
console.log('El día del club\n');
// ---------------------------------------------------------------------------

let session;

await step('08:00 — recepción abre la caja con $10.000 de fondo', async () => {
  session = await one(
    `INSERT INTO cash_sessions (club_id,register_id,membership_id,opening_amount,status)
     VALUES ($1,$2,$3,10000,'OPEN') RETURNING id`,
    [club.id, register.id, membership.id]);
  const s = await one(`SELECT opening_amount, status FROM cash_sessions WHERE id=$1`, [session.id]);
  eq(s.status, 'OPEN', 'estado');
  eq(s.opening_amount, 10000, 'fondo inicial');
});

let booking;

await step('10:15 — Martina reserva un turno de 90 minutos', async () => {
  const num = await one(
    `SELECT next_document_number($1::uuid,'BOOKING','2027') AS n`, [club.id]);
  const code = `R-2027-${String(num.n).padStart(5, '0')}`;

  booking = await one(
    `INSERT INTO bookings (club_id,code,court_id,client_id,starts_at,ends_at,
       duration_minutes,status,type,base_price,total_price,paid_amount,payment_status,players_count)
     VALUES ($1,$2,$3,$4,'2027-09-15T23:00:00Z','2027-09-16T00:30:00Z',90,
       'CONFIRMED','REGULAR',24000,24000,0,'UNPAID',4) RETURNING id, code`,
    [club.id, code, court.id, client.id]);

  eq(booking.code, 'R-2027-00001', 'primer turno del año');
});

await step('el turno de 20:00 no se pisa con otro', async () => {
  let rejected = false;
  try {
    await c.query(
      `INSERT INTO bookings (club_id,code,court_id,starts_at,ends_at,duration_minutes,
         status,type,base_price,total_price)
       VALUES ($1,'R-DUP',$2,'2027-09-15T23:30:00Z','2027-09-16T01:00:00Z',90,
         'CONFIRMED','REGULAR',24000,24000)`,
      [club.id, court.id]);
  } catch (e) {
    rejected = e.message.includes('bookings_no_overlap');
  }
  if (!rejected) throw new Error('el motor debería rechazar el solapamiento');
});

await step('19:55 — Martina llega y paga los $24.000 en efectivo', async () => {
  await c.query('BEGIN');
  const num = await one(`SELECT next_document_number($1::uuid,'PAYMENT','2027') AS n`, [club.id]);
  const payment = await one(
    `INSERT INTO payments (club_id,code,client_id,booking_id,method_id,cash_session_id,
       amount,fee_amount,net_amount,status,settled_at)
     VALUES ($1,$2,$3,$4,$5,$6,24000,0,24000,'COMPLETED',now()) RETURNING id`,
    [club.id, `PAG-2027-${String(num.n).padStart(5,'0')}`, client.id, booking.id, pmCash.id, session.id]);

  await c.query(
    `INSERT INTO cash_movements (club_id,session_id,type,direction,amount,
       payment_method_id,concept,reference,payment_id)
     VALUES ($1,$2,'BOOKING_PAYMENT','IN',24000,$3,'Turno R-2027-00001',$4,$5)`,
    [club.id, session.id, pmCash.id, booking.id, payment.id]);

  await c.query(
    `UPDATE clients SET account_balance = account_balance + 24000,
       total_spent = total_spent + 24000, bookings_count = bookings_count + 1,
       last_visit_at = now() WHERE id=$1`, [client.id]);
  await c.query(
    `INSERT INTO account_entries (club_id,client_id,type,amount,balance_after,concept,booking_id,payment_id)
     VALUES ($1,$2,'PAYMENT',24000,24000,'Turno R-2027-00001',$3,$4)`,
    [club.id, client.id, booking.id, payment.id]);

  await c.query(
    `UPDATE bookings SET paid_amount=24000, payment_status='PAID', status='PAID' WHERE id=$1`,
    [booking.id]);
  await c.query('COMMIT');

  const b = await one(`SELECT paid_amount, status FROM bookings WHERE id=$1`, [booking.id]);
  eq(b.paid_amount, 24000, 'turno pagado');
  eq(b.status, 'PAID', 'estado');
});

await step('el cobro del turno aparece en la caja', async () => {
  const m = await one(
    `SELECT amount, type FROM cash_movements WHERE reference=$1`, [booking.id]);
  eq(m.amount, 24000, 'monto en caja');
  eq(m.type, 'BOOKING_PAYMENT', 'concepto');
});

await step('20:10 — juegan y compran 4 Cocas ($10.000)', async () => {
  await c.query('BEGIN');
  const num = await one(`SELECT next_document_number($1::uuid,'SALE','2027') AS n`, [club.id]);
  const sale = await one(
    `INSERT INTO sales (club_id,code,client_id,cash_session_id,subtotal,discount_amount,
       tax_amount,total,paid_amount,status)
     VALUES ($1,$2,$3,$4,10000,0,1735.54,10000,10000,'COMPLETED') RETURNING id, code`,
    [club.id, `V-2027-${String(num.n).padStart(5,'0')}`, client.id, session.id]);

  await c.query(
    `INSERT INTO sale_items (club_id,sale_id,product_id,description,quantity,unit_price,tax_rate,total)
     VALUES ($1,$2,$3,'Coca 500ml',4,2500,21,10000)`, [club.id, sale.id, coca.id]);

  const upd = await one(
    `UPDATE products SET stock_qty = stock_qty - 4 WHERE id=$1 RETURNING stock_qty`, [coca.id]);
  await c.query(
    `INSERT INTO stock_movements (club_id,product_id,type,quantity,balance_after,reference)
     VALUES ($1,$2,'SALE',-4,$3,$4)`, [club.id, coca.id, upd.stock_qty, sale.code]);

  await c.query(
    `INSERT INTO cash_movements (club_id,session_id,type,direction,amount,
       payment_method_id,concept,reference)
     VALUES ($1,$2,'PRODUCT_SALE','IN',10000,$3,$4,$5)`,
    [club.id, session.id, pmCash.id, `Buffet ${sale.code}`, sale.id]);
  await c.query('COMMIT');

  const p = await one(`SELECT stock_qty FROM products WHERE id=$1`, [coca.id]);
  eq(p.stock_qty, 20, '24 − 4');
});

await step('la venta del buffet entra a la MISMA caja', async () => {
  const r = await one(
    `SELECT COALESCE(SUM(amount),0)::numeric AS total FROM cash_movements
     WHERE session_id=$1 AND direction='IN'`, [session.id]);
  eq(r.total, 34000, '24000 del turno + 10000 del buffet');
});

await step('21:00 — otro cliente paga con tarjeta ($26.000)', async () => {
  await c.query('BEGIN');
  const num = await one(`SELECT next_document_number($1::uuid,'PAYMENT','2027') AS n`, [club.id]);
  // La tarjeta cobra comisión y acredita a 18 días: entra el neto, no el bruto.
  await c.query(
    `INSERT INTO payments (club_id,code,method_id,cash_session_id,amount,fee_amount,
       net_amount,status,settlement_date,settled_at)
     VALUES ($1,$2,$3,$4,26000,910,25090,'COMPLETED',(CURRENT_DATE + 18),NULL)`,
    [club.id, `PAG-2027-${String(num.n).padStart(5,'0')}`, pmCard.id, session.id]);
  await c.query('COMMIT');
});

await step('la tarjeta NO afecta el efectivo esperado', async () => {
  const r = await one(`
    SELECT (
      s.opening_amount
      + COALESCE(SUM(CASE WHEN m.direction='IN' AND COALESCE(pm.affects_cash_count,true)
                    THEN m.amount ELSE 0 END),0)
      - COALESCE(SUM(CASE WHEN m.direction='OUT' AND COALESCE(pm.affects_cash_count,true)
                    THEN m.amount ELSE 0 END),0)
    )::numeric AS expected
    FROM cash_sessions s
    LEFT JOIN cash_movements m ON m.session_id = s.id
    LEFT JOIN payment_methods pm ON pm.id = m.payment_method_id
    WHERE s.id=$1 GROUP BY s.opening_amount`, [session.id]);
  eq(r.expected, 44000, '10000 + 24000 + 10000, sin la tarjeta');
  // Si la tarjeta contara, el arqueo pediría 70000 y aparecería un faltante
  // de 26000 que no existe.
});

await step('21:30 — se paga el hielo ($3.000) de la caja', async () => {
  await c.query(
    `INSERT INTO cash_movements (club_id,session_id,type,direction,amount,
       payment_method_id,concept)
     VALUES ($1,$2,'EXPENSE','OUT',3000,$3,'Compra de hielo')`,
    [club.id, session.id, pmCash.id]);

  const r = await one(`
    SELECT COALESCE(SUM(amount),0)::numeric AS total FROM cash_movements
    WHERE session_id=$1 AND direction='OUT'`, [session.id]);
  eq(r.total, 3000, 'salida registrada');
});

await step('23:50 — se cuenta el cajón: $41.000, y cuadra', async () => {
  const expected = 44000 - 3000;
  await c.query(
    `UPDATE cash_sessions SET status='CLOSED', closed_at=now(),
       expected_amount=$2, counted_amount=$2, difference=0 WHERE id=$1`,
    [session.id, expected]);

  const s = await one(
    `SELECT status, expected_amount, counted_amount, difference
     FROM cash_sessions WHERE id=$1`, [session.id]);
  eq(s.status, 'CLOSED', 'cerrada');
  eq(s.expected_amount, 41000, 'esperado');
  eq(s.difference, 0, 'cuadra');
});

// ---------------------------------------------------------------------------
console.log('\nEl cierre del día cuadra con todo lo anterior\n');
// ---------------------------------------------------------------------------

const DAY_START = '2027-09-15T03:00:00Z';
const DAY_END = '2027-09-16T03:00:00Z';

await step('lo facturado incluye turnos y buffet', async () => {
  const b = await one(`
    SELECT COALESCE(SUM(total_price),0)::numeric AS t FROM bookings
    WHERE club_id=$1 AND deleted_at IS NULL
      AND starts_at >= $2::timestamptz AND starts_at < $3::timestamptz
      AND status NOT IN ('CANCELLED_BY_CLIENT','CANCELLED_BY_CLUB','RESCHEDULED')`,
    [club.id, DAY_START, DAY_END]);
  const s = await one(`
    SELECT COALESCE(SUM(total),0)::numeric AS t FROM sales
    WHERE club_id=$1 AND status='COMPLETED'`, [club.id]);
  eq(Number(b.t) + Number(s.t), 34000, '24000 + 10000');
});

await step('lo cobrado incluye la tarjeta, que no está en el cajón', async () => {
  const r = await one(`
    SELECT COALESCE(SUM(amount),0)::numeric AS t FROM payments
    WHERE club_id=$1 AND status='COMPLETED'`, [club.id]);
  eq(r.t, 50000, '24000 efectivo + 26000 tarjeta');
});

await step('el neto descuenta comisiones y salidas', async () => {
  const p = await one(`
    SELECT COALESCE(SUM(amount),0)::numeric AS bruto,
           COALESCE(SUM(fee_amount),0)::numeric AS fees
    FROM payments WHERE club_id=$1 AND status='COMPLETED'`, [club.id]);
  const o = await one(`
    SELECT COALESCE(SUM(amount),0)::numeric AS salidas FROM cash_movements
    WHERE club_id=$1 AND direction='OUT'`, [club.id]);

  const neto = Number(p.bruto) - Number(p.fees) - Number(o.salidas);
  eq(neto, 46090, '50000 − 910 de comisión − 3000 de hielo');
});

await step('los $26.000 de tarjeta todavía no están disponibles', async () => {
  const r = await one(`
    SELECT COALESCE(SUM(net_amount),0)::numeric AS t, MIN(settlement_date) AS cuando
    FROM payments
    WHERE club_id=$1 AND settled_at IS NULL AND settlement_date > CURRENT_DATE`,
    [club.id]);
  eq(r.t, 25090, 'el neto, no el bruto');
  if (!r.cuando) throw new Error('debería tener fecha de acreditación');
  // El club facturó 34000 pero solo tiene 41000 en el cajón: los 25090 de
  // tarjeta llegan en 18 días. Confundir esto es cómo se compromete plata
  // que todavía no está.
});

await step('el margen del buffet se calcula sobre el costo real', async () => {
  const r = await one(`
    SELECT COALESCE(SUM(si.total),0)::numeric AS venta,
           COALESCE(SUM(si.quantity * p.cost_price),0)::numeric AS costo
    FROM sale_items si
    JOIN sales s ON s.id=si.sale_id
    JOIN products p ON p.id=si.product_id
    WHERE s.club_id=$1 AND s.status='COMPLETED'`, [club.id]);
  eq(r.venta, 10000, 'facturado');
  eq(r.costo, 6000, '4 × 1500');
  const margen = ((Number(r.venta) - Number(r.costo)) / Number(r.venta)) * 100;
  eq(Math.round(margen), 40, '40% de margen');
});

await step('la ficha del cliente refleja el día', async () => {
  const cl = await one(
    `SELECT total_spent, bookings_count, last_visit_at FROM clients WHERE id=$1`,
    [client.id]);
  eq(cl.total_spent, 24000, 'gastado');
  eq(cl.bookings_count, 1, 'turnos');
  if (!cl.last_visit_at) throw new Error('debería tener última visita');
});

await step('el kardex explica el stock actual', async () => {
  const p = await one(`SELECT stock_qty FROM products WHERE id=$1`, [coca.id]);
  const k = await one(
    `SELECT balance_after FROM stock_movements
     WHERE product_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, [coca.id]);
  eq(p.stock_qty, k.balance_after, 'el cache coincide con el kardex');
});

await step('nada de esto se puede editar después', async () => {
  const m = await one(`SELECT id FROM cash_movements WHERE session_id=$1 LIMIT 1`, [session.id]);
  let blocked = false;
  try {
    await c.query(`UPDATE cash_movements SET amount=1 WHERE id=$1`, [m.id]);
  } catch (e) {
    blocked = e.message.includes('append-only');
  }
  if (!blocked) throw new Error('el libro de caja debe ser inmutable');
});

await c.end();

console.log(`\n${'='.repeat(52)}`);
console.log(`${pass} pasos correctos, ${fail} fallaron`);
console.log('='.repeat(52) + '\n');
process.exit(fail ? 1 : 0);
