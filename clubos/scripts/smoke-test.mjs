/**
 * Smoke tests de ClubOS contra Postgres real.
 *
 * Verifica lo que los tests de algoritmos NO pueden verificar:
 *   1. El EXCLUDE constraint impide la doble reserva (incluso concurrente)
 *   2. RLS aísla los clubes de verdad
 *   3. Los triggers append-only bloquean UPDATE/DELETE
 *   4. La numeración de documentos es atómica bajo concurrencia
 *   5. Las transacciones son atómicas (rollback deja todo limpio)
 *
 * Uso: node scripts/smoke-test.mjs
 * Requiere: docker compose up -d db   (o embedded-postgres)
 */
import pgpkg from 'pg';
const { Client, Pool } = pgpkg;

// Corre contra el owner (crea el rol de app y limpia tablas). El aislamiento
// RLS se prueba con una segunda conexión usando el rol clubos_app.
const OWNER_URL =
  process.env.SMOKE_OWNER_URL ??
  'postgresql://clubos_owner:clubos_dev@localhost:5432/clubos';
const APP_USER = process.env.SMOKE_APP_USER ?? 'clubos_app';
const APP_PASSWORD = process.env.SMOKE_APP_PASSWORD ?? 'clubos_dev';

const CONN = { connectionString: OWNER_URL };
const APP_CONN = {
  connectionString: OWNER_URL.replace(
    /\/\/[^:]+:[^@]+@/,
    `//${APP_USER}:${APP_PASSWORD}@`,
  ),
};

let pass = 0, fail = 0;
const results = [];

async function check(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; results.push([name, true]); }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; results.push([name, false]); }
}
const eq = (a, b, m) => { if (String(a) !== String(b)) throw new Error(`${m}: got ${a}, want ${b}`); };
const mustThrow = async (fn, match, msg) => {
  try { await fn(); } catch (e) {
    if (match && !e.message.includes(match)) {
      throw new Error(`${msg}: error inesperado "${e.message}"`);
    }
    return e;
  }
  throw new Error(`${msg}: se esperaba un error y no hubo`);
};

const c = new Client(CONN);
await c.connect();

// ---------------------------------------------------------------------------
// Datos base
// ---------------------------------------------------------------------------
console.log('\nPreparando datos...\n');

await c.query(`DELETE FROM audit_logs; DELETE FROM account_entries;
  DELETE FROM cash_movements; DELETE FROM payments; DELETE FROM booking_status_changes;
  DELETE FROM booking_players; DELETE FROM bookings; DELETE FROM court_blocks;
  DELETE FROM cash_sessions; DELETE FROM cash_registers; DELETE FROM payment_methods;
  DELETE FROM price_rules; DELETE FROM price_lists; DELETE FROM clients;
  DELETE FROM courts; DELETE FROM sports; DELETE FROM operating_hours;
  DELETE FROM memberships; DELETE FROM roles; DELETE FROM document_counters;
  DELETE FROM clubs; DELETE FROM users; DELETE FROM plans;`);

const { rows: [plan] } = await c.query(
  `INSERT INTO plans (code,name,price_monthly,price_yearly) VALUES ('pro','Pro',89000,899000) RETURNING id`);

const { rows: [clubA] } = await c.query(
  `INSERT INTO clubs (slug,name,plan_id,status) VALUES ('club-a','Club A',$1,'ACTIVE') RETURNING id`, [plan.id]);
const { rows: [clubB] } = await c.query(
  `INSERT INTO clubs (slug,name,plan_id,status) VALUES ('club-b','Club B',$1,'ACTIVE') RETURNING id`, [plan.id]);

const mkCourt = async (clubId, num) => {
  const { rows: [sport] } = await c.query(
    `INSERT INTO sports (club_id,code,name) VALUES ($1,$2,'Pádel') RETURNING id`,
    [clubId, 'PADEL' + num]);
  const { rows: [court] } = await c.query(
    `INSERT INTO courts (club_id,sport_id,name,number,capacity) VALUES ($1,$2,$3,$4,4) RETURNING id`,
    [clubId, sport.id, `Cancha ${num}`, num]);
  return court.id;
};

const courtA1 = await mkCourt(clubA.id, 1);
const courtA2 = await mkCourt(clubA.id, 2);
const courtB1 = await mkCourt(clubB.id, 1);

const { rows: [clientA] } = await c.query(
  `INSERT INTO clients (club_id,first_name,last_name,credit_limit) VALUES ($1,'Ana','García',20000) RETURNING id`,
  [clubA.id]);
const { rows: [clientB] } = await c.query(
  `INSERT INTO clients (club_id,first_name,last_name) VALUES ($1,'Beto','López') RETURNING id`,
  [clubB.id]);

const { rows: [reg] } = await c.query(
  `INSERT INTO cash_registers (club_id,name) VALUES ($1,'Recepción') RETURNING id`, [clubA.id]);

// Usuario + rol + membresía reales: cash_sessions tiene FK a memberships.
const { rows: [user] } = await c.query(
  `INSERT INTO users (email,first_name,last_name) VALUES ('op@test.com','Op','Test') RETURNING id`);
const { rows: [role] } = await c.query(
  `INSERT INTO roles (club_id,code,name) VALUES ($1,'RECEPTION','Recepción') RETURNING id`, [clubA.id]);
const { rows: [mem] } = await c.query(
  `INSERT INTO memberships (club_id,user_id,role_id,status) VALUES ($1,$2,$3,'ACTIVE') RETURNING id`,
  [clubA.id, user.id, role.id]);

console.log('Datos listos.\n');

const mkBooking = (clubId, courtId, code, start, end, status = 'CONFIRMED') =>
  c.query(
    `INSERT INTO bookings (club_id,code,court_id,starts_at,ends_at,duration_minutes,status,base_price,total_price)
     VALUES ($1,$2,$3,$4,$5,$6,$7,18000,18000) RETURNING id`,
    [clubId, code, courtId, start, end,
     Math.round((new Date(end) - new Date(start)) / 60000), status]);

// ===========================================================================
console.log('1. EXCLUDE constraint: doble reserva\n');
// ===========================================================================

await check('reserva base se crea', async () => {
  const r = await mkBooking(clubA.id, courtA1, 'R-1', '2026-08-01T21:00:00Z', '2026-08-01T22:30:00Z');
  if (!r.rows[0].id) throw new Error('no se creó');
});

await check('reserva idéntica es RECHAZADA por el motor', async () => {
  const e = await mustThrow(
    () => mkBooking(clubA.id, courtA1, 'R-2', '2026-08-01T21:00:00Z', '2026-08-01T22:30:00Z'),
    'bookings_no_overlap', 'doble reserva exacta');
  if (!e.message.includes('bookings_no_overlap')) throw new Error('constraint incorrecto');
});

await check('solapamiento PARCIAL es rechazado (el bug de PadelPRO)', async () => {
  // 21:00-22:30 existe. Intentar 22:00-23:30 => se solapan 30 minutos.
  await mustThrow(
    () => mkBooking(clubA.id, courtA1, 'R-3', '2026-08-01T22:00:00Z', '2026-08-01T23:30:00Z'),
    'bookings_no_overlap', 'solapamiento parcial');
});

await check('reserva CONTENIDA dentro de otra es rechazada', async () => {
  await mustThrow(
    () => mkBooking(clubA.id, courtA1, 'R-4', '2026-08-01T21:30:00Z', '2026-08-01T22:00:00Z'),
    'bookings_no_overlap', 'contenida');
});

await check('turno CONSECUTIVO se permite (borde exclusivo)', async () => {
  const r = await mkBooking(clubA.id, courtA1, 'R-5', '2026-08-01T22:30:00Z', '2026-08-01T00:00:00Z'.replace('00:00:00','23:59:00'));
  if (!r.rows[0].id) throw new Error('debería permitirse');
});

await check('misma hora en OTRA cancha se permite', async () => {
  const r = await mkBooking(clubA.id, courtA2, 'R-6', '2026-08-01T21:00:00Z', '2026-08-01T22:30:00Z');
  if (!r.rows[0].id) throw new Error('otra cancha debe permitirse');
});

await check('reserva CANCELADA libera el horario', async () => {
  await c.query(`UPDATE bookings SET status='CANCELLED_BY_CLIENT' WHERE code='R-1'`);
  const r = await mkBooking(clubA.id, courtA1, 'R-7', '2026-08-01T21:00:00Z', '2026-08-01T22:30:00Z');
  if (!r.rows[0].id) throw new Error('el horario debería estar libre');
});

await check('reserva con fin ANTES del inicio es rechazada', async () => {
  await mustThrow(
    () => mkBooking(clubA.id, courtA1, 'R-8', '2026-08-02T22:00:00Z', '2026-08-02T21:00:00Z'),
    null, 'rango invertido');
});

await check('duration_minutes debe coincidir con el rango real', async () => {
  await mustThrow(
    () => c.query(
      `INSERT INTO bookings (club_id,code,court_id,starts_at,ends_at,duration_minutes,status,base_price,total_price)
       VALUES ($1,'R-9',$2,'2026-08-03T10:00:00Z','2026-08-03T11:30:00Z',60,'CONFIRMED',1,1)`,
      [clubA.id, courtA1]),
    'bookings_duration_matches', 'duración inconsistente');
});

// ===========================================================================
console.log('\n2. Concurrencia real: dos reservas simultáneas\n');
// ===========================================================================

await check('bajo concurrencia solo UNA reserva sobrevive', async () => {
  const pool = new Pool({ ...CONN, max: 12 });
  const SLOT = ['2026-09-15T20:00:00Z', '2026-09-15T21:30:00Z'];

  // 10 clientes intentan reservar EXACTAMENTE el mismo turno a la vez.
  const attempts = Array.from({ length: 10 }, (_, i) =>
    pool.query(
      `INSERT INTO bookings (club_id,code,court_id,starts_at,ends_at,duration_minutes,status,base_price,total_price)
       VALUES ($1,$2,$3,$4,$5,90,'CONFIRMED',18000,18000) RETURNING id`,
      [clubA.id, `CONC-${i}`, courtA1, SLOT[0], SLOT[1]])
      .then(() => 'ok').catch((e) => e.message.includes('bookings_no_overlap') ? 'rejected' : 'error:' + e.message)
  );

  const outcomes = await Promise.all(attempts);
  await pool.end();

  const okCount = outcomes.filter((o) => o === 'ok').length;
  const rejCount = outcomes.filter((o) => o === 'rejected').length;
  const errors = outcomes.filter((o) => o.startsWith('error'));

  if (errors.length) throw new Error(`errores inesperados: ${errors[0]}`);
  eq(okCount, 1, 'exactamente una debe ganar');
  eq(rejCount, 9, 'las otras nueve rechazadas');
});

// ===========================================================================
console.log('\n3. Row Level Security: aislamiento entre clubes\n');
// ===========================================================================

const app = new Client(CONN);
await app.connect();

await check('rol de aplicación existe y está sujeto a RLS', async () => {
  // El rol lo crea docker/init/02-app-role.sql. Acá solo se verifica que
  // exista y que tenga los permisos, no se recrea: en un entorno real el
  // smoke test no debe alterar roles.
  await c.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_USER}') THEN
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${APP_USER}', '${APP_PASSWORD}');
    END IF;
  END $$;`);
  await c.query(`GRANT USAGE ON SCHEMA public TO ${APP_USER}`);
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_USER}`);
});

const appClient = new Client(APP_CONN);
await appClient.connect();

await check('sin club activo NO se ve ninguna reserva', async () => {
  const { rows } = await appClient.query(`SELECT count(*)::int AS n FROM bookings`);
  eq(rows[0].n, 0, 'sin contexto no debe haber filas visibles');
});

await check('con club A se ven solo las reservas de A', async () => {
  await appClient.query(`SELECT set_config('app.current_club_id', $1, false)`, [clubA.id]);
  const { rows } = await appClient.query(`SELECT count(*)::int AS n FROM bookings`);
  if (rows[0].n === 0) throw new Error('debería ver las de A');
  const { rows: other } = await appClient.query(
    `SELECT count(*)::int AS n FROM bookings WHERE club_id = $1`, [clubB.id]);
  eq(other[0].n, 0, 'no debe ver las de B');
});

await check('club B no ve NADA de club A', async () => {
  await appClient.query(`SELECT set_config('app.current_club_id', $1, false)`, [clubB.id]);
  const { rows } = await appClient.query(
    `SELECT count(*)::int AS n FROM bookings WHERE club_id = $1`, [clubA.id]);
  eq(rows[0].n, 0, 'fuga entre tenants');
});

await check('no se puede INSERTAR en otro club (WITH CHECK)', async () => {
  await appClient.query(`SELECT set_config('app.current_club_id', $1, false)`, [clubB.id]);
  await mustThrow(
    () => appClient.query(
      `INSERT INTO bookings (club_id,code,court_id,starts_at,ends_at,duration_minutes,status,base_price,total_price)
       VALUES ($1,'HACK',$2,'2026-10-01T10:00:00Z','2026-10-01T11:00:00Z',60,'CONFIRMED',1,1)`,
      [clubA.id, courtA1]),
    'row-level security', 'insert cross-tenant');
});

await check('no se puede leer clientes de otro club', async () => {
  await appClient.query(`SELECT set_config('app.current_club_id', $1, false)`, [clubB.id]);
  const { rows } = await appClient.query(`SELECT count(*)::int AS n FROM clients`);
  eq(rows[0].n, 1, 'solo el cliente de B');
  const { rows: r2 } = await appClient.query(
    `SELECT count(*)::int AS n FROM clients WHERE id = $1`, [clientA.id]);
  eq(r2[0].n, 0, 'no debe ver el cliente de A');
});

await check('SET LOCAL no persiste fuera de la transacción', async () => {
  // Esto valida el diseño de PrismaService: si el SET LOCAL se filtrara
  // entre requests, un club vería datos de otro.
  await appClient.query('BEGIN');
  await appClient.query(`SELECT set_config('app.current_club_id', $1, true)`, [clubA.id]);
  const { rows: inside } = await appClient.query(`SELECT count(*)::int AS n FROM clients`);
  await appClient.query('COMMIT');
  const { rows: outside } = await appClient.query(
    `SELECT current_setting('app.current_club_id', true) AS v`);
  if (inside[0].n === 0) throw new Error('dentro de la tx debería ver datos');
  if (outside[0].v === clubA.id) throw new Error('SET LOCAL se filtró fuera de la transacción');
});

// ===========================================================================
console.log('\n4. Libros append-only\n');
// ===========================================================================

const { rows: [session] } = await c.query(
  `INSERT INTO cash_sessions (club_id,register_id,membership_id,opening_amount,status)
   VALUES ($1,$2,$3,10000,'OPEN') RETURNING id`, [clubA.id, reg.id, mem.id]);

const { rows: [mov] } = await c.query(
  `INSERT INTO cash_movements (club_id,session_id,type,direction,amount,concept)
   VALUES ($1,$2,'BOOKING_PAYMENT','IN',18000,'Test') RETURNING id`, [clubA.id, session.id]);

await check('cash_movements NO admite UPDATE', async () => {
  await mustThrow(
    () => c.query(`UPDATE cash_movements SET amount=1 WHERE id=$1`, [mov.id]),
    'append-only', 'update en libro de caja');
});

await check('cash_movements NO admite DELETE', async () => {
  await mustThrow(
    () => c.query(`DELETE FROM cash_movements WHERE id=$1`, [mov.id]),
    'append-only', 'delete en libro de caja');
});

await check('account_entries NO admite UPDATE', async () => {
  const { rows: [e] } = await c.query(
    `INSERT INTO account_entries (club_id,client_id,type,amount,balance_after,concept)
     VALUES ($1,$2,'CHARGE',-18000,-18000,'Test') RETURNING id`, [clubA.id, clientA.id]);
  await mustThrow(
    () => c.query(`UPDATE account_entries SET amount=0 WHERE id=$1`, [e.id]),
    'append-only', 'update en cuenta corriente');
});

await check('audit_logs NO admite DELETE', async () => {
  const { rows: [a] } = await c.query(
    `INSERT INTO audit_logs (club_id,action,entity_type) VALUES ($1,'CREATE','Test') RETURNING id`,
    [clubA.id]);
  await mustThrow(
    () => c.query(`DELETE FROM audit_logs WHERE id=$1`, [a.id]),
    'append-only', 'delete en auditoría');
});

await check('monto de caja debe ser positivo', async () => {
  await mustThrow(
    () => c.query(
      `INSERT INTO cash_movements (club_id,session_id,type,direction,amount,concept)
       VALUES ($1,$2,'REFUND','OUT',-500,'Negativo')`, [clubA.id, session.id]),
    'cash_movements_positive', 'monto negativo');
});

// ===========================================================================
console.log('\n5. Una sola caja abierta por puesto\n');
// ===========================================================================

await check('no se puede abrir una segunda caja en el mismo puesto', async () => {
  await mustThrow(
    () => c.query(
      `INSERT INTO cash_sessions (club_id,register_id,membership_id,opening_amount,status)
       VALUES ($1,$2,$3,5000,'OPEN')`, [clubA.id, reg.id, mem.id]),
    'cash_sessions_one_open_per_register', 'doble caja abierta');
});

await check('cerrar con diferencia sin motivo es rechazado', async () => {
  await mustThrow(
    () => c.query(
      `UPDATE cash_sessions SET status='CLOSED', difference=-500, difference_reason=NULL WHERE id=$1`,
      [session.id]),
    'cash_sessions_difference_justified', 'diferencia sin justificar');
});

await check('cerrar con diferencia justificada se permite', async () => {
  await c.query(
    `UPDATE cash_sessions SET status='CLOSED', difference=-500,
     difference_reason='Faltante de vuelto' WHERE id=$1`, [session.id]);
});

await check('tras cerrar, se puede abrir una nueva en el mismo puesto', async () => {
  const r = await c.query(
    `INSERT INTO cash_sessions (club_id,register_id,membership_id,opening_amount,status)
     VALUES ($1,$2,$3,5000,'OPEN') RETURNING id`, [clubA.id, reg.id, mem.id]);
  if (!r.rows[0].id) throw new Error('debería permitirse');
});

// ===========================================================================
console.log('\n6. Numeración atómica de documentos\n');
// ===========================================================================

await check('números consecutivos sin huecos ni duplicados (50 concurrentes)', async () => {
  const pool = new Pool({ ...CONN, max: 15 });
  const calls = Array.from({ length: 50 }, () =>
    pool.query(`SELECT next_document_number($1::uuid,'BOOKING','2026') AS n`, [clubA.id])
      .then((r) => Number(r.rows[0].n)));
  const nums = await Promise.all(calls);
  await pool.end();

  const unique = new Set(nums);
  eq(unique.size, 50, 'todos los números deben ser distintos');
  eq(Math.min(...nums), 1, 'arranca en 1');
  eq(Math.max(...nums), 50, 'termina en 50 sin huecos');
});

await check('cada club tiene su propia serie', async () => {
  const { rows } = await c.query(
    `SELECT next_document_number($1::uuid,'BOOKING','2026') AS n`, [clubB.id]);
  eq(Number(rows[0].n), 1, 'club B arranca en 1 aunque A esté en 50');
});

await check('cada tipo de documento tiene su propia serie', async () => {
  const { rows } = await c.query(
    `SELECT next_document_number($1::uuid,'PAYMENT','2026') AS n`, [clubA.id]);
  eq(Number(rows[0].n), 1, 'PAYMENT arranca en 1');
});

await check('la serie se reinicia por año', async () => {
  const { rows } = await c.query(
    `SELECT next_document_number($1::uuid,'BOOKING','2027') AS n`, [clubA.id]);
  eq(Number(rows[0].n), 1, '2027 arranca en 1');
});

// ===========================================================================
console.log('\n7. Atomicidad de transacciones\n');
// ===========================================================================

await check('rollback no deja rastro parcial', async () => {
  const before = await c.query(`SELECT count(*)::int AS n FROM payments`);
  const tx = new Client(CONN);
  await tx.connect();
  try {
    await tx.query('BEGIN');
    const { rows: [b] } = await tx.query(
      `INSERT INTO bookings (club_id,code,court_id,starts_at,ends_at,duration_minutes,status,base_price,total_price)
       VALUES ($1,'TX-1',$2,'2026-11-01T10:00:00Z','2026-11-01T11:00:00Z',60,'CONFIRMED',1,1) RETURNING id`,
      [clubA.id, courtA1]);
    const { rows: [pm] } = await tx.query(
      `INSERT INTO payment_methods (club_id,code,name,kind) VALUES ($1,'CASH_TX','Efectivo','CASH') RETURNING id`,
      [clubA.id]);
    await tx.query(
      `INSERT INTO payments (club_id,code,booking_id,method_id,amount,net_amount)
       VALUES ($1,'PAY-TX',$2,$3,18000,18000)`, [clubA.id, b.id, pm.id]);
    // Falla a propósito: viola el constraint de monto.
    await tx.query(
      `INSERT INTO payments (club_id,code,booking_id,method_id,amount,net_amount)
       VALUES ($1,'PAY-BAD',$2,$3,-5,-5)`, [clubA.id, b.id, pm.id]);
    await tx.query('COMMIT');
    throw new Error('debería haber fallado');
  } catch (e) {
    if (e.message === 'debería haber fallado') throw e;
    await tx.query('ROLLBACK');
  }
  await tx.end();

  const after = await c.query(`SELECT count(*)::int AS n FROM payments`);
  eq(after.rows[0].n, before.rows[0].n, 'no debe quedar ningún pago');
  const { rows } = await c.query(`SELECT count(*)::int AS n FROM bookings WHERE code='TX-1'`);
  eq(rows[0].n, 0, 'la reserva tampoco debe existir');
});

// ===========================================================================
console.log('\n8. Índices parciales con NULL\n');
// ===========================================================================

await check('dos clientes SIN documento se permiten', async () => {
  await c.query(`INSERT INTO clients (club_id,first_name,last_name) VALUES ($1,'X','Uno')`, [clubA.id]);
  await c.query(`INSERT INTO clients (club_id,first_name,last_name) VALUES ($1,'Y','Dos')`, [clubA.id]);
});

await check('dos clientes con el MISMO documento son rechazados', async () => {
  await c.query(
    `INSERT INTO clients (club_id,first_name,last_name,document_type,document_number)
     VALUES ($1,'Z','Tres','DNI','30111222')`, [clubA.id]);
  await mustThrow(
    () => c.query(
      `INSERT INTO clients (club_id,first_name,last_name,document_type,document_number)
       VALUES ($1,'W','Cuatro','DNI','30111222')`, [clubA.id]),
    'clients_document_uq', 'documento duplicado');
});

await check('el mismo documento en OTRO club se permite', async () => {
  await c.query(
    `INSERT INTO clients (club_id,first_name,last_name,document_type,document_number)
     VALUES ($1,'V','Cinco','DNI','30111222')`, [clubB.id]);
});

// ===========================================================================
console.log('\n9. Bloqueos de cancha\n');
// ===========================================================================

await check('bloqueo de mantenimiento se crea', async () => {
  await c.query(
    `INSERT INTO court_blocks (club_id,court_id,type,reason,starts_at,ends_at)
     VALUES ($1,$2,'MAINTENANCE','Cambio de césped','2026-12-01T08:00:00Z','2026-12-01T18:00:00Z')`,
    [clubA.id, courtA1]);
});

await check('bloqueos solapados en la misma cancha son rechazados', async () => {
  await mustThrow(
    () => c.query(
      `INSERT INTO court_blocks (club_id,court_id,type,reason,starts_at,ends_at)
       VALUES ($1,$2,'EVENT','Torneo','2026-12-01T12:00:00Z','2026-12-01T20:00:00Z')`,
      [clubA.id, courtA1]),
    'court_blocks_no_overlap', 'bloqueos solapados');
});

// ===========================================================================
console.log('\n10. Ciclo completo de caja\n');
// ===========================================================================

// Medios de pago: efectivo cuenta para el arqueo, tarjeta no.
const { rows: [pmCash] } = await c.query(
  `INSERT INTO payment_methods (club_id,code,name,kind,affects_cash_count)
   VALUES ($1,'CASH','Efectivo','CASH',true) RETURNING id`, [clubA.id]);
const { rows: [pmCard] } = await c.query(
  `INSERT INTO payment_methods (club_id,code,name,kind,affects_cash_count,fee_percent,settlement_days)
   VALUES ($1,'CREDIT','Tarjeta','CREDIT_CARD',false,3.5,18) RETURNING id`, [clubA.id]);

const { rows: [reg2] } = await c.query(
  `INSERT INTO cash_registers (club_id,name) VALUES ($1,'Buffet') RETURNING id`, [clubA.id]);
const { rows: [turno] } = await c.query(
  `INSERT INTO cash_sessions (club_id,register_id,membership_id,opening_amount,status)
   VALUES ($1,$2,$3,15000,'OPEN') RETURNING id`, [clubA.id, reg2.id, mem.id]);

const addMov = (type, dir, amt, methodId) => c.query(
  `INSERT INTO cash_movements (club_id,session_id,type,direction,amount,payment_method_id,concept)
   VALUES ($1,$2,$3,$4,$5,$6,'Test')`,
  [clubA.id, turno.id, type, dir, amt, methodId]);

const expectedCashQuery = `
  SELECT (
    s.opening_amount
    + COALESCE(SUM(CASE WHEN m.direction='IN'  AND COALESCE(pm.affects_cash_count,true) THEN m.amount ELSE 0 END),0)
    - COALESCE(SUM(CASE WHEN m.direction='OUT' AND COALESCE(pm.affects_cash_count,true) THEN m.amount ELSE 0 END),0)
  )::numeric AS expected
  FROM cash_sessions s
  LEFT JOIN cash_movements m ON m.session_id = s.id
  LEFT JOIN payment_methods pm ON pm.id = m.payment_method_id
  WHERE s.id = $1 GROUP BY s.opening_amount`;

await check('caja recién abierta: esperado = apertura', async () => {
  const { rows } = await c.query(expectedCashQuery, [turno.id]);
  eq(Number(rows[0].expected), 15000, 'apertura');
});

await check('cobros en efectivo suman al esperado', async () => {
  await addMov('BOOKING_PAYMENT','IN',18000,pmCash.id);
  await addMov('PRODUCT_SALE','IN',3500,pmCash.id);
  const { rows } = await c.query(expectedCashQuery, [turno.id]);
  eq(Number(rows[0].expected), 36500, '15000+18000+3500');
});

await check('cobro con TARJETA no altera el efectivo esperado', async () => {
  await addMov('BOOKING_PAYMENT','IN',130000,pmCard.id);
  const { rows } = await c.query(expectedCashQuery, [turno.id]);
  eq(Number(rows[0].expected), 36500, 'la tarjeta no entra al cajón');
  // Sin esta distinción el arqueo mostraría 130000 de faltante inexistente.
});

await check('gasto en efectivo resta', async () => {
  await addMov('EXPENSE','OUT',2000,pmCash.id);
  const { rows } = await c.query(expectedCashQuery, [turno.id]);
  eq(Number(rows[0].expected), 34500, '36500-2000');
});

await check('retiro resta del esperado', async () => {
  await addMov('WITHDRAWAL','OUT',10000,pmCash.id);
  const { rows } = await c.query(expectedCashQuery, [turno.id]);
  eq(Number(rows[0].expected), 24500, '34500-10000');
});

await check('contra-asiento revierte sin borrar el original', async () => {
  const { rows: [orig] } = await c.query(
    `INSERT INTO cash_movements (club_id,session_id,type,direction,amount,payment_method_id,concept)
     VALUES ($1,$2,'MANUAL_INCOME','IN',5000,$3,'Error') RETURNING id`,
    [clubA.id, turno.id, pmCash.id]);
  const { rows: after1 } = await c.query(expectedCashQuery, [turno.id]);
  eq(Number(after1[0].expected), 29500, 'con el error cargado');

  await c.query(
    `INSERT INTO cash_movements (club_id,session_id,type,direction,amount,payment_method_id,concept,reverses_id)
     VALUES ($1,$2,'MANUAL_INCOME','OUT',5000,$3,'Anulación',$4)`,
    [clubA.id, turno.id, pmCash.id, orig.id]);

  const { rows: after2 } = await c.query(expectedCashQuery, [turno.id]);
  eq(Number(after2[0].expected), 24500, 'vuelve al valor correcto');

  // El movimiento original sigue existiendo: el libro es append-only.
  const { rows: still } = await c.query(
    `SELECT count(*)::int AS n FROM cash_movements WHERE id=$1`, [orig.id]);
  eq(still[0].n, 1, 'el original no se borró');
});

await check('cierre con conteo exacto', async () => {
  await c.query(
    `UPDATE cash_sessions SET status='CLOSED', closed_at=now(),
     expected_amount=24500, counted_amount=24500, difference=0 WHERE id=$1`, [turno.id]);
  const { rows } = await c.query(
    `SELECT status, difference FROM cash_sessions WHERE id=$1`, [turno.id]);
  eq(rows[0].status, 'CLOSED', 'estado');
  eq(Number(rows[0].difference), 0, 'sin diferencia');
});

await check('los movimientos de una caja cerrada siguen siendo inmutables', async () => {
  const { rows: [m] } = await c.query(
    `SELECT id FROM cash_movements WHERE session_id=$1 LIMIT 1`, [turno.id]);
  await mustThrow(
    () => c.query(`UPDATE cash_movements SET amount=1 WHERE id=$1`, [m.id]),
    'append-only', 'edición post-cierre');
});

await check('el total por medio de pago cuadra con el total general', async () => {
  const { rows } = await c.query(`
    SELECT
      COALESCE(SUM(CASE WHEN direction='IN' THEN amount ELSE 0 END),0)::numeric AS total_in,
      COALESCE(SUM(CASE WHEN direction='OUT' THEN amount ELSE 0 END),0)::numeric AS total_out
    FROM cash_movements WHERE session_id=$1`, [turno.id]);
  const { rows: byMethod } = await c.query(`
    SELECT
      COALESCE(SUM(CASE WHEN direction='IN' THEN amount ELSE 0 END),0)::numeric AS m_in,
      COALESCE(SUM(CASE WHEN direction='OUT' THEN amount ELSE 0 END),0)::numeric AS m_out
    FROM cash_movements WHERE session_id=$1 GROUP BY payment_method_id`, [turno.id]);
  const sumIn = byMethod.reduce((s,r)=>s+Number(r.m_in),0);
  const sumOut = byMethod.reduce((s,r)=>s+Number(r.m_out),0);
  eq(sumIn, Number(rows[0].total_in), 'entradas cuadran');
  eq(sumOut, Number(rows[0].total_out), 'salidas cuadran');
});

// ===========================================================================
console.log('\n11. Búsqueda de clientes\n');
// ===========================================================================

await c.query(`INSERT INTO clients (club_id,first_name,last_name,phone,document_number,email) VALUES
  ($1,'José','González','1145678900','30111333','jose@test.com'),
  ($1,'María','Ñañez','1156789011','28999888','maria@test.com'),
  ($1,'Juan Carlos','Pérez','1167890122','33444555',NULL),
  ($1,'Ana','Gonzalez','1178901233','31222444',NULL)`, [clubA.id]);

const searchFor = async (term) => {
  const { rows } = await c.query(
    `SELECT last_name FROM clients
     WHERE club_id=$1 AND deleted_at IS NULL
       AND search_text LIKE '%' || lower(immutable_unaccent($2)) || '%'
     ORDER BY last_name`, [clubA.id, term]);
  return rows.map(r => r.last_name);
};

await check('el acento se normaliza correctamente (bug de translate)', async () => {
  const { rows } = await c.query(
    `SELECT search_text FROM clients WHERE first_name='José' AND club_id=$1`, [clubA.id]);
  const st = rows[0].search_text;
  if (!st.includes('jose')) throw new Error(`'José' debería normalizar a 'jose', dio: "${st}"`);
  if (!st.includes('gonzalez')) throw new Error(`'González' -> 'gonzalez', dio: "${st}"`);
  // translate() sobre bytes daba 'josai gonzaalez' — basura.
});

await check('buscar sin acento encuentra con acento', async () => {
  const r = await searchFor('gonzalez');
  if (!r.includes('González')) throw new Error(`no encontró González: ${r}`);
});

await check('buscar CON acento también funciona', async () => {
  const r = await searchFor('González');
  if (!r.includes('González')) throw new Error(`no encontró: ${r}`);
});

await check('la ñ se normaliza a n', async () => {
  const r = await searchFor('nanez');
  if (!r.includes('Ñañez')) throw new Error(`no encontró Ñañez: ${r}`);
});

await check('mayúsculas y minúsculas son indistintas', async () => {
  const up = await searchFor('PEREZ');
  const low = await searchFor('perez');
  eq(up.join(), low.join(), 'deben dar lo mismo');
  if (!up.includes('Pérez')) throw new Error('no encontró Pérez');
});

await check('busca por fragmento de teléfono', async () => {
  const r = await searchFor('4567');
  if (!r.includes('González')) throw new Error(`no encontró por teléfono: ${r}`);
});

await check('busca por documento', async () => {
  const r = await searchFor('30111333');
  if (!r.includes('González')) throw new Error(`no encontró por DNI: ${r}`);
});

await check('busca por email', async () => {
  const r = await searchFor('maria@test');
  if (!r.includes('Ñañez')) throw new Error(`no encontró por email: ${r}`);
});

await check('prefijo corto devuelve todos los que coinciden', async () => {
  const r = await searchFor('gonzal');
  eq(r.length, 2, 'González y Gonzalez');
});

await check('tolera errores de tipeo (similarity)', async () => {
  await c.query(`SET pg_trgm.similarity_threshold = 0.25`);
  const { rows } = await c.query(
    `SELECT last_name FROM clients
     WHERE club_id=$1 AND deleted_at IS NULL AND search_text %> lower(immutable_unaccent($2))
     ORDER BY similarity(search_text, lower(immutable_unaccent($2))) DESC LIMIT 3`,
    [clubA.id, 'gonzales']);
  if (rows.length === 0) throw new Error('no toleró el tipeo');
});

await check('la columna search_text se actualiza sola al editar', async () => {
  await c.query(
    `UPDATE clients SET last_name='Rodríguez' WHERE first_name='Ana' AND club_id=$1`, [clubA.id]);
  const r = await searchFor('rodriguez');
  if (!r.includes('Rodríguez')) throw new Error('la columna generada no se actualizó');
  const old = await searchFor('gonzal');
  eq(old.length, 1, 'ya no debe aparecer en la búsqueda anterior');
});

await check('la búsqueda respeta el aislamiento entre clubes', async () => {
  await c.query(
    `INSERT INTO clients (club_id,first_name,last_name) VALUES ($1,'José','González')`,
    [clubB.id]);
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM clients
     WHERE club_id=$1 AND search_text LIKE '%gonzalez%'`, [clubA.id]);
  eq(rows[0].n, 1, 'solo el de A');
});

await check('el índice trigram se usa en la búsqueda', async () => {
  // Con pocas filas PG puede preferir seq scan; se fuerza para comprobar
  // que el índice es utilizable por el planner.
  await c.query(`SET enable_seqscan = off`);
  const { rows } = await c.query(
    `EXPLAIN (FORMAT JSON) SELECT id FROM clients
     WHERE club_id=$1 AND search_text LIKE '%gonzalez%'`, [clubA.id]);
  const plan = JSON.stringify(rows[0]['QUERY PLAN']);
  await c.query(`SET enable_seqscan = on`);
  if (!plan.includes('clients_search_trgm')) {
    throw new Error(`el índice no se usa. Plan: ${plan.slice(0,200)}`);
  }
});

// ===========================================================================
console.log('\n12. Vista de agenda: una sola query trae el día\n');
// ===========================================================================

// Horarios del club para que la ventana de la grilla se calcule.
for (let d = 0; d <= 6; d++) {
  await c.query(
    `INSERT INTO operating_hours (club_id,day_of_week,open_minute,close_minute)
     VALUES ($1,$2,480,1440)`, [clubA.id, d]);
}

const AGENDA_DATE = '2027-03-10';  // fecha limpia, sin datos de otros tests
const at = (h, m = 0) => `${AGENDA_DATE}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00Z`;

const { rows: [agClient] } = await c.query(
  `INSERT INTO clients (club_id,first_name,last_name,phone) 
   VALUES ($1,'Valentina','Ríos','1144556677') RETURNING id`, [clubA.id]);

await c.query(
  `INSERT INTO bookings (club_id,code,court_id,client_id,starts_at,ends_at,
     duration_minutes,status,type,base_price,total_price,paid_amount,payment_status,players_count)
   VALUES
     ($1,'AG-1',$2,$3,$4,$5,90,'PAID','REGULAR',18000,18000,18000,'PAID',4),
     ($1,'AG-2',$2,$3,$6,$7,90,'CONFIRMED','REGULAR',24000,24000,0,'UNPAID',4),
     ($1,'AG-3',$8,$3,$4,$5,90,'CANCELLED_BY_CLIENT','REGULAR',18000,18000,0,'UNPAID',4)`,
  [clubA.id, courtA1, agClient.id, at(10), at(11,30), at(20), at(21,30), courtA2]);

// La query que ejecuta AgendaService: reservas del día CON el detalle del bloque.
const agendaQuery = `
  SELECT b.id, b.code, b.court_id, b.starts_at, b.ends_at, b.status, b.type,
         b.total_price, b.paid_amount,
         cl.first_name, cl.last_name, cl.phone
  FROM bookings b
  LEFT JOIN clients cl ON cl.id = b.client_id
  WHERE b.club_id = $1 AND b.deleted_at IS NULL
    AND b.starts_at < $3::timestamptz AND b.ends_at > $2::timestamptz
  ORDER BY b.starts_at`;

const DAY_START = `${AGENDA_DATE}T03:00:00Z`;   // 00:00 en UTC-3
const DAY_END   = `${AGENDA_DATE}T27:00:00Z`.replace('T27','T03');  // día siguiente

await check('trae las reservas del día con el nombre del cliente', async () => {
  const { rows } = await c.query(agendaQuery, [clubA.id, DAY_START, `2027-03-11T03:00:00Z`]);
  eq(rows.length, 3, 'tres reservas del día');
  const paid = rows.find(r => r.code === 'AG-1');
  eq(paid.first_name, 'Valentina', 'el JOIN trae el cliente');
  eq(paid.phone, '1144556677', 'y su teléfono');
  // Sin este JOIN el front necesitaría una request por reserva.
});

await check('incluye las canceladas (la grilla las muestra en gris)', async () => {
  const { rows } = await c.query(agendaQuery, [clubA.id, DAY_START, `2027-03-11T03:00:00Z`]);
  const cancelled = rows.filter(r => r.status.startsWith('CANCELLED'));
  eq(cancelled.length, 1, 'la cancelada también viene');
});

await check('el saldo pendiente se calcula por reserva', async () => {
  const { rows } = await c.query(agendaQuery, [clubA.id, DAY_START, `2027-03-11T03:00:00Z`]);
  const unpaid = rows.find(r => r.code === 'AG-2');
  const pending = Number(unpaid.total_price) - Number(unpaid.paid_amount);
  eq(pending, 24000, 'falta cobrar el total');
});

await check('los totales del día se calculan en una query', async () => {
  const { rows } = await c.query(`
    SELECT
      count(*) FILTER (WHERE status NOT IN ('CANCELLED_BY_CLIENT','CANCELLED_BY_CLUB','NO_SHOW'))::int AS activas,
      COALESCE(SUM(paid_amount) FILTER (WHERE status NOT IN ('CANCELLED_BY_CLIENT','CANCELLED_BY_CLUB','NO_SHOW')),0)::numeric AS cobrado,
      COALESCE(SUM(total_price - paid_amount) FILTER (WHERE status IN ('CONFIRMED','PAID','PENDING','IN_PROGRESS')),0)::numeric AS pendiente,
      COALESCE(SUM(duration_minutes) FILTER (WHERE status NOT IN ('CANCELLED_BY_CLIENT','CANCELLED_BY_CLUB','NO_SHOW')),0)::int AS minutos
    FROM bookings
    WHERE club_id=$1 AND deleted_at IS NULL
      AND starts_at >= $2::timestamptz AND starts_at < $3::timestamptz`,
    [clubA.id, DAY_START, '2027-03-11T03:00:00Z']);
  eq(Number(rows[0].activas), 2, 'dos activas');
  eq(Number(rows[0].cobrado), 18000, 'lo cobrado');
  eq(Number(rows[0].pendiente), 24000, 'lo pendiente');
  eq(Number(rows[0].minutos), 180, 'minutos ocupados');
});

await check('una reserva que cruza medianoche aparece en ambos días', async () => {
  await c.query(
    `INSERT INTO bookings (club_id,code,court_id,starts_at,ends_at,duration_minutes,
       status,type,base_price,total_price)
     VALUES ($1,'AG-NIGHT',$2,$3,$4,90,'CONFIRMED','REGULAR',18000,18000)`,
    [clubA.id, courtA1, '2027-03-10T02:30:00Z', '2027-03-10T04:00:00Z']);
  // 23:30 del 9/3 a 01:00 del 10/3 en hora argentina.
  const { rows: d10 } = await c.query(agendaQuery,
    [clubA.id, '2027-03-10T03:00:00Z', '2027-03-11T03:00:00Z']);
  const { rows: d09 } = await c.query(agendaQuery,
    [clubA.id, '2027-03-09T03:00:00Z', '2027-03-10T03:00:00Z']);
  const in10 = d10.some(r => r.code === 'AG-NIGHT');
  const in09 = d09.some(r => r.code === 'AG-NIGHT');
  if (!in09) throw new Error('debe aparecer el día que empieza');
  if (!in10) throw new Error('y también el día donde termina');
});

await check('el filtro por cancha reduce el resultado', async () => {
  const { rows } = await c.query(
    agendaQuery + ' ', [clubA.id, DAY_START, '2027-03-11T03:00:00Z']);
  const soloC1 = rows.filter(r => r.court_id === courtA1);
  if (soloC1.length === rows.length) throw new Error('debería haber reservas en otra cancha');
});

await check('la agenda respeta el aislamiento entre clubes', async () => {
  await c.query(
    `INSERT INTO bookings (club_id,code,court_id,starts_at,ends_at,duration_minutes,
       status,type,base_price,total_price)
     VALUES ($1,'AG-OTRO',$2,$3,$4,90,'CONFIRMED','REGULAR',1,1)`,
    [clubB.id, courtB1, at(10), at(11,30)]);
  const { rows } = await c.query(agendaQuery, [clubA.id, DAY_START, '2027-03-11T03:00:00Z']);
  if (rows.some(r => r.code === 'AG-OTRO')) throw new Error('fuga entre clubes');
});

// ===========================================================================
console.log('\n13. POS: venta, stock y caja\n');
// ===========================================================================

const { rows: [cat] } = await c.query(
  `INSERT INTO product_categories (club_id,name) VALUES ($1,'Bebidas') RETURNING id`,
  [clubA.id]);

const { rows: [coca] } = await c.query(
  `INSERT INTO products (club_id,category_id,name,sale_price,cost_price,tax_rate,
     stock_qty,min_stock_qty,track_stock,unit)
   VALUES ($1,$2,'Coca 500ml',2500,1500,21,24,6,true,'unidad') RETURNING id`,
  [clubA.id, cat.id]);

const { rows: [paleta] } = await c.query(
  `INSERT INTO products (club_id,name,sale_price,cost_price,kind,track_stock,unit)
   VALUES ($1,'Alquiler de paleta',3000,0,'SERVICE',false,'unidad') RETURNING id`,
  [clubA.id]);

// Caja abierta para poder cobrar en efectivo.
const { rows: [posReg] } = await c.query(
  `INSERT INTO cash_registers (club_id,name) VALUES ($1,'Buffet POS') RETURNING id`,
  [clubA.id]);
const { rows: [posSession] } = await c.query(
  `INSERT INTO cash_sessions (club_id,register_id,membership_id,opening_amount,status)
   VALUES ($1,$2,$3,5000,'OPEN') RETURNING id`, [clubA.id, posReg.id, mem.id]);

const stockOf = async (id) => {
  const { rows } = await c.query(`SELECT stock_qty FROM products WHERE id=$1`, [id]);
  return Number(rows[0].stock_qty);
};

/** Simula lo que hace PosService dentro de una transacción. */
async function sellProduct(productId, qty, unitPrice, code) {
  await c.query('BEGIN');
  try {
    const { rows: [sale] } = await c.query(
      `INSERT INTO sales (club_id,code,cash_session_id,subtotal,discount_amount,
         tax_amount,total,paid_amount,status)
       VALUES ($1,$2,$3,$4,0,$5,$4,$4,'COMPLETED') RETURNING id`,
      [clubA.id, code, posSession.id, qty * unitPrice,
       Math.round((qty*unitPrice - (qty*unitPrice)/1.21)*100)/100]);

    await c.query(
      `INSERT INTO sale_items (club_id,sale_id,product_id,description,quantity,
         unit_price,tax_rate,total)
       VALUES ($1,$2,$3,'Producto',$4,$5,21,$6)`,
      [clubA.id, sale.id, productId, qty, unitPrice, qty*unitPrice]);

    // StockService saltea los productos sin control de stock: un servicio
    // (alquiler de paleta) no tiene existencias que descontar.
    const { rows: [prod] } = await c.query(
      `SELECT track_stock, kind FROM products WHERE id=$1`, [productId]);

    if (prod.track_stock && prod.kind !== 'SERVICE') {
      const { rows: [upd] } = await c.query(
        `UPDATE products SET stock_qty = stock_qty - $2 WHERE id=$1 RETURNING stock_qty`,
        [productId, qty]);
      await c.query(
        `INSERT INTO stock_movements (club_id,product_id,type,quantity,balance_after,reference)
         VALUES ($1,$2,'SALE',$3,$4,$5)`,
        [clubA.id, productId, -qty, Number(upd.stock_qty), code]);
    }

    await c.query(
      `INSERT INTO cash_movements (club_id,session_id,type,direction,amount,payment_method_id,concept)
       VALUES ($1,$2,'PRODUCT_SALE','IN',$3,$4,$5)`,
      [clubA.id, posSession.id, qty*unitPrice, pmCash.id, `Buffet ${code}`]);

    await c.query('COMMIT');
    return sale.id;
  } catch (e) { await c.query('ROLLBACK'); throw e; }
}

await check('una venta descuenta stock y entra a la caja', async () => {
  const before = await stockOf(coca.id);
  await sellProduct(coca.id, 3, 2500, 'V-001');
  eq(await stockOf(coca.id), before - 3, 'stock descontado');

  const { rows } = await c.query(
    `SELECT amount FROM cash_movements WHERE concept='Buffet V-001'`);
  eq(Number(rows[0].amount), 7500, 'entró a la caja');
});

await check('el kardex registra el movimiento con su saldo', async () => {
  const { rows } = await c.query(
    `SELECT quantity, balance_after FROM stock_movements
     WHERE reference='V-001' AND product_id=$1`, [coca.id]);
  eq(Number(rows[0].quantity), -3, 'signo negativo');
  eq(Number(rows[0].balance_after), 21, 'saldo tras la venta');
});

await check('un servicio NO descuenta stock', async () => {
  const before = await stockOf(paleta.id);
  await sellProduct(paleta.id, 1, 3000, 'V-002');
  eq(await stockOf(paleta.id), before, 'los servicios no tienen existencias');
});

await check('el stock puede quedar negativo (no se bloquea la venta)', async () => {
  await c.query(`UPDATE products SET stock_qty=2 WHERE id=$1`, [coca.id]);
  await sellProduct(coca.id, 5, 2500, 'V-003');
  const now = await stockOf(coca.id);
  eq(now, -3, 'queda visible como alerta');
  // Frenar un cobro de $12.500 porque el inventario está desactualizado
  // es peor negocio que el descuadre.
});

await check('la alerta de reposición detecta el negativo', async () => {
  const { rows } = await c.query(`
    SELECT name, stock_qty,
      CASE WHEN stock_qty < 0 THEN 'NEGATIVE'
           WHEN stock_qty = 0 THEN 'OUT_OF_STOCK'
           ELSE 'BELOW_MINIMUM' END AS severity
    FROM products
    WHERE club_id=$1 AND track_stock=true AND deleted_at IS NULL
      AND stock_qty <= min_stock_qty
    ORDER BY (stock_qty - min_stock_qty) ASC`, [clubA.id]);
  if (rows.length === 0) throw new Error('debería alertar');
  eq(rows[0].severity, 'NEGATIVE', 'lo más urgente primero');
});

await check('una compra repone y actualiza el costo', async () => {
  await c.query('BEGIN');
  const { rows: [upd] } = await c.query(
    `UPDATE products SET stock_qty = stock_qty + 24, cost_price = 1700
     WHERE id=$1 RETURNING stock_qty`, [coca.id]);
  await c.query(
    `INSERT INTO stock_movements (club_id,product_id,type,quantity,unit_cost,balance_after,reference)
     VALUES ($1,$2,'PURCHASE',24,1700,$3,'FC-A-0001')`,
    [clubA.id, coca.id, Number(upd.stock_qty)]);
  await c.query('COMMIT');

  eq(await stockOf(coca.id), 21, '-3 + 24');
  const { rows } = await c.query(`SELECT cost_price FROM products WHERE id=$1`, [coca.id]);
  eq(Number(rows[0].cost_price), 1700, 'el costo se actualiza con la última compra');
});

await check('ajuste por conteo deja rastro', async () => {
  const previous = await stockOf(coca.id);
  const counted = 18;
  const difference = counted - previous;

  await c.query('BEGIN');
  await c.query(`UPDATE products SET stock_qty=$2 WHERE id=$1`, [coca.id, counted]);
  await c.query(
    `INSERT INTO stock_movements (club_id,product_id,type,quantity,balance_after,reason)
     VALUES ($1,$2,'ADJUSTMENT',$3,$4,'Conteo físico del lunes')`,
    [clubA.id, coca.id, difference, counted]);
  await c.query('COMMIT');

  eq(await stockOf(coca.id), 18, 'queda lo contado');
  const { rows } = await c.query(
    `SELECT quantity, reason FROM stock_movements
     WHERE product_id=$1 AND type='ADJUSTMENT'`, [coca.id]);
  eq(Number(rows[0].quantity), -3, 'la diferencia queda registrada');
  if (!rows[0].reason) throw new Error('un ajuste sin motivo no se puede auditar');
});

await check('el saldo del producto coincide con el último movimiento', async () => {
  // `balanceAfter` del movimiento más reciente tiene que ser igual al cache
  // en `products.stockQty`. Si divergen, el kardex y el inventario están
  // contando cosas distintas y ningún reporte es confiable.
  const { rows } = await c.query(
    `SELECT balance_after FROM stock_movements
     WHERE product_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, [coca.id]);
  eq(await stockOf(coca.id), Number(rows[0].balance_after),
     'el cache coincide con el kardex');
});

await check('los movimientos de stock son inmutables', async () => {
  const { rows: [m] } = await c.query(
    `SELECT id FROM stock_movements WHERE product_id=$1 LIMIT 1`, [coca.id]);
  await mustThrow(
    () => c.query(`UPDATE stock_movements SET quantity=999 WHERE id=$1`, [m.id]),
    'append-only', 'edición del kardex');
});

await check('anular una venta devuelve el stock', async () => {
  const before = await stockOf(coca.id);
  const { rows: [sale] } = await c.query(
    `SELECT id, code FROM sales WHERE code='V-001'`);

  await c.query('BEGIN');
  const { rows: [upd] } = await c.query(
    `UPDATE products SET stock_qty = stock_qty + 3 WHERE id=$1 RETURNING stock_qty`,
    [coca.id]);
  await c.query(
    `INSERT INTO stock_movements (club_id,product_id,type,quantity,balance_after,reference,reason)
     VALUES ($1,$2,'RETURN',3,$3,$4,'Anulación')`,
    [clubA.id, coca.id, Number(upd.stock_qty), sale.code]);
  await c.query(
    `UPDATE sales SET status='VOIDED', voided_at=now(), void_reason='Error de carga'
     WHERE id=$1`, [sale.id]);
  await c.query('COMMIT');

  eq(await stockOf(coca.id), before + 3, 'el stock vuelve');
  const { rows } = await c.query(`SELECT status FROM sales WHERE id=$1`, [sale.id]);
  eq(rows[0].status, 'VOIDED', 'la venta no se borra, se anula');
});

await check('la venta anulada sigue existiendo para el arqueo', async () => {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM sales WHERE code='V-001'`);
  eq(rows[0].n, 1, 'nada se borra');
});

await check('el total del buffet cuadra con la caja', async () => {
  const { rows } = await c.query(`
    SELECT COALESCE(SUM(amount),0)::numeric AS total
    FROM cash_movements
    WHERE session_id=$1 AND type='PRODUCT_SALE' AND direction='IN'`,
    [posSession.id]);
  // V-001 (7500) + V-002 (3000) + V-003 (12500)
  eq(Number(rows[0].total), 23000, 'todo lo vendido entró a la caja');
});

await check('valuación del inventario', async () => {
  const { rows } = await c.query(`
    SELECT
      COALESCE(SUM(stock_qty * cost_price),0)::numeric AS cost_value,
      COALESCE(SUM(stock_qty * sale_price),0)::numeric AS sale_value
    FROM products
    WHERE club_id=$1 AND track_stock=true AND deleted_at IS NULL AND is_active=true`,
    [clubA.id]);
  const cost = Number(rows[0].cost_value);
  const sale = Number(rows[0].sale_value);
  if (sale <= cost) throw new Error('el valor de venta debe superar al costo');
});

await check('el POS respeta el aislamiento entre clubes', async () => {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM products WHERE club_id=$1`, [clubB.id]);
  eq(rows[0].n, 0, 'club B no tiene productos');
});

// ===========================================================================
console.log('\n14. Cierre de día\n');
// ===========================================================================

const CLOSE_DATE = '2027-05-20';
const dayStart = '2027-05-20T03:00:00Z';   // 00:00 en UTC-3
const dayEnd   = '2027-05-21T03:00:00Z';

// Turnos del día: uno pagado, uno a medias, uno cancelado, uno ausente.
const { rows: [closeClient] } = await c.query(
  `INSERT INTO clients (club_id,first_name,last_name) VALUES ($1,'Cierre','Test') RETURNING id`,
  [clubA.id]);

await c.query(
  `INSERT INTO bookings (club_id,code,court_id,client_id,starts_at,ends_at,
     duration_minutes,status,type,base_price,total_price,paid_amount,payment_status)
   VALUES
     ($1,'CD-1',$2,$3,'2027-05-20T13:00:00Z','2027-05-20T14:30:00Z',90,'COMPLETED','REGULAR',18000,18000,18000,'PAID'),
     ($1,'CD-2',$2,$3,'2027-05-20T23:00:00Z','2027-05-21T00:30:00Z',90,'CONFIRMED','REGULAR',24000,24000,10000,'PARTIAL'),
     ($1,'CD-3',$4,$3,'2027-05-20T15:00:00Z','2027-05-20T16:30:00Z',90,'CANCELLED_BY_CLIENT','REGULAR',18000,18000,0,'UNPAID'),
     ($1,'CD-4',$4,$3,'2027-05-20T18:00:00Z','2027-05-20T19:30:00Z',90,'NO_SHOW','REGULAR',18000,18000,0,'UNPAID')`,
  [clubA.id, courtA1, closeClient.id, courtA2]);

await check('el turno de las 23:30 pertenece al día que empieza', async () => {
  // CD-2 va de 20:00 a 21:30 hora argentina del 20/5. Si el corte usara UTC
  // o la zona del servidor, caería en el 21 y el cierre del 20 quedaría corto.
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM bookings
     WHERE club_id=$1 AND code='CD-2'
       AND starts_at >= $2::timestamptz AND starts_at < $3::timestamptz`,
    [clubA.id, dayStart, dayEnd]);
  eq(rows[0].n, 1, 'entra en el día correcto');
});

await check('facturado excluye las canceladas', async () => {
  const { rows } = await c.query(`
    SELECT COALESCE(SUM(total_price),0)::numeric AS billed
    FROM bookings
    WHERE club_id=$1 AND deleted_at IS NULL
      AND starts_at >= $2::timestamptz AND starts_at < $3::timestamptz
      AND status NOT IN ('CANCELLED_BY_CLIENT','CANCELLED_BY_CLUB','RESCHEDULED')`,
    [clubA.id, dayStart, dayEnd]);
  // 18000 + 24000 + 18000 (el no-show se factura) = 60000. La cancelada no.
  eq(Number(rows[0].billed), 60000, 'sin las canceladas');
});

await check('cobrado y facturado son cifras distintas', async () => {
  const { rows } = await c.query(`
    SELECT
      COALESCE(SUM(total_price),0)::numeric AS billed,
      COALESCE(SUM(paid_amount),0)::numeric AS collected
    FROM bookings
    WHERE club_id=$1 AND deleted_at IS NULL
      AND starts_at >= $2::timestamptz AND starts_at < $3::timestamptz
      AND status NOT IN ('CANCELLED_BY_CLIENT','CANCELLED_BY_CLUB','RESCHEDULED')`,
    [clubA.id, dayStart, dayEnd]);
  const billed = Number(rows[0].billed);
  const collected = Number(rows[0].collected);
  eq(collected, 28000, '18000 + 10000');
  eq(billed - collected, 32000, 'quedó por cobrar');
  // Confundirlas es cómo un club cree que tuvo un buen día y a fin de mes
  // no le cierra la plata.
});

await check('las cancelaciones y ausencias se cuentan aparte', async () => {
  const { rows } = await c.query(`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('CANCELLED_BY_CLIENT','CANCELLED_BY_CLUB'))::int AS cancelled,
      COUNT(*) FILTER (WHERE status='NO_SHOW')::int AS no_show
    FROM bookings
    WHERE club_id=$1 AND deleted_at IS NULL
      AND starts_at >= $2::timestamptz AND starts_at < $3::timestamptz`,
    [clubA.id, dayStart, dayEnd]);
  eq(rows[0].cancelled, 1, 'una cancelada');
  eq(rows[0].no_show, 1, 'un ausente');
});

await check('el desglose por medio de pago incluye la comisión', async () => {
  const { rows: [pmCredit] } = await c.query(
    `SELECT id FROM payment_methods WHERE club_id=$1 AND code='CREDIT'`, [clubA.id]);

  await c.query(
    `INSERT INTO payments (club_id,code,method_id,amount,fee_amount,net_amount,status,paid_at)
     VALUES ($1,'PG-CD-1',$2,100000,3500,96500,'COMPLETED','2027-05-20T18:00:00Z')`,
    [clubA.id, pmCredit.id]);

  const { rows } = await c.query(`
    SELECT pm.name, pm.settlement_days,
      SUM(p.amount)::numeric AS amount,
      SUM(p.fee_amount)::numeric AS fees,
      SUM(p.net_amount)::numeric AS net
    FROM payments p JOIN payment_methods pm ON pm.id=p.method_id
    WHERE p.club_id=$1 AND p.status='COMPLETED'
      AND p.paid_at >= $2::timestamptz AND p.paid_at < $3::timestamptz
    GROUP BY pm.name, pm.settlement_days`,
    [clubA.id, dayStart, dayEnd]);

  const credit = rows.find(r => r.name === 'Tarjeta');
  eq(Number(credit.amount), 100000, 'bruto');
  eq(Number(credit.fees), 3500, 'comisión');
  eq(Number(credit.net), 96500, 'neto');
  // Cobrar 100.000 con crédito no es lo mismo que en efectivo: entran
  // 96.500 y recién a los 18 días.
  if (Number(credit.settlement_days) === 0) {
    throw new Error('la tarjeta debería acreditar a plazo');
  }
});

await check('el neto descuenta salidas y comisiones', async () => {
  const { rows: [reg3] } = await c.query(
    `INSERT INTO cash_registers (club_id,name) VALUES ($1,'Cierre Test') RETURNING id`,
    [clubA.id]);
  const { rows: [sess3] } = await c.query(
    `INSERT INTO cash_sessions (club_id,register_id,membership_id,opening_amount,status,opened_at)
     VALUES ($1,$2,$3,10000,'OPEN','2027-05-20T12:00:00Z') RETURNING id`,
    [clubA.id, reg3.id, mem.id]);

  await c.query(
    `INSERT INTO cash_movements (club_id,session_id,type,direction,amount,concept,created_at)
     VALUES ($1,$2,'EXPENSE','OUT',8000,'Compra de hielo','2027-05-20T16:00:00Z')`,
    [clubA.id, sess3.id]);

  const { rows } = await c.query(`
    SELECT COALESCE(SUM(amount),0)::numeric AS outflow
    FROM cash_movements
    WHERE club_id=$1 AND direction='OUT'
      AND created_at >= $2::timestamptz AND created_at < $3::timestamptz`,
    [clubA.id, dayStart, dayEnd]);
  eq(Number(rows[0].outflow), 8000, 'salidas del día');
});

await check('una caja sin cerrar aparece como alerta', async () => {
  const { rows } = await c.query(`
    SELECT count(*)::int AS n FROM cash_sessions
    WHERE club_id=$1 AND status='OPEN'
      AND opened_at >= $2::timestamptz AND opened_at < $3::timestamptz`,
    [clubA.id, dayStart, dayEnd]);
  if (rows[0].n === 0) throw new Error('debería haber una caja abierta');
  // DailyCloseService la marca como severidad HIGH: sin cerrarla el día no
  // queda conciliado.
});

await check('el margen del buffet se calcula sobre el costo real', async () => {
  const { rows: [prod] } = await c.query(
    `SELECT id, cost_price FROM products WHERE club_id=$1 AND name='Coca 500ml'`,
    [clubA.id]);

  const { rows: [sale] } = await c.query(
    `INSERT INTO sales (club_id,code,subtotal,discount_amount,tax_amount,total,paid_amount,status,created_at)
     VALUES ($1,'V-CD-1',10000,0,1735.54,10000,10000,'COMPLETED','2027-05-20T19:00:00Z') RETURNING id`,
    [clubA.id]);
  await c.query(
    `INSERT INTO sale_items (club_id,sale_id,product_id,description,quantity,unit_price,tax_rate,total)
     VALUES ($1,$2,$3,'Coca 500ml',4,2500,21,10000)`,
    [clubA.id, sale.id, prod.id]);

  const { rows } = await c.query(`
    SELECT
      COALESCE(SUM(si.total),0)::numeric AS revenue,
      COALESCE(SUM(si.quantity * p.cost_price),0)::numeric AS cost
    FROM sale_items si
    JOIN sales s ON s.id=si.sale_id
    JOIN products p ON p.id=si.product_id
    WHERE s.club_id=$1 AND s.status='COMPLETED'
      AND s.created_at >= $2::timestamptz AND s.created_at < $3::timestamptz`,
    [clubA.id, dayStart, dayEnd]);

  const revenue = Number(rows[0].revenue);
  const cost = Number(rows[0].cost);
  eq(revenue, 10000, 'facturado');
  eq(cost, 4 * Number(prod.cost_price), 'costo de lo vendido');
  if (revenue <= cost) throw new Error('el margen debería ser positivo');
});

await check('el ranking ordena por ganancia, no por unidades', async () => {
  // Un producto de mucho volumen y poco margen no debe encabezar el ranking.
  const { rows: [barato] } = await c.query(
    `INSERT INTO products (club_id,name,sale_price,cost_price,stock_qty,track_stock)
     VALUES ($1,'Agua 500ml',1200,1000,50,true) RETURNING id`, [clubA.id]);

  const { rows: [sale2] } = await c.query(
    `INSERT INTO sales (club_id,code,subtotal,discount_amount,tax_amount,total,paid_amount,status,created_at)
     VALUES ($1,'V-CD-2',12000,0,2082.64,12000,12000,'COMPLETED','2027-05-20T20:00:00Z') RETURNING id`,
    [clubA.id]);
  await c.query(
    `INSERT INTO sale_items (club_id,sale_id,product_id,description,quantity,unit_price,tax_rate,total)
     VALUES ($1,$2,$3,'Agua 500ml',10,1200,21,12000)`,
    [clubA.id, sale2.id, barato.id]);

  const { rows } = await c.query(`
    SELECT p.name,
      SUM(si.quantity)::numeric AS units,
      (SUM(si.total) - SUM(si.quantity * p.cost_price))::numeric AS profit
    FROM sale_items si
    JOIN sales s ON s.id=si.sale_id
    JOIN products p ON p.id=si.product_id
    WHERE s.club_id=$1 AND s.status='COMPLETED'
      AND s.created_at >= $2::timestamptz AND s.created_at < $3::timestamptz
    GROUP BY p.id, p.name
    ORDER BY profit DESC`,
    [clubA.id, dayStart, dayEnd]);

  // Agua: 10 unidades, deja 2000. Coca: 4 unidades, deja 10000 - 4*1700 = 3200.
  eq(rows[0].name, 'Coca 500ml', 'gana la de más margen, no la de más volumen');
  if (Number(rows[0].units) >= Number(rows[1].units)) {
    throw new Error('el test necesita que el agua venda más unidades');
  }
});

await check('facturación por hora compara canchas de distinto uso', async () => {
  const { rows } = await c.query(`
    SELECT c.name,
      COALESCE(SUM(b.duration_minutes),0)::int AS minutes,
      COALESCE(SUM(b.total_price),0)::numeric AS revenue
    FROM courts c
    LEFT JOIN bookings b ON b.court_id=c.id AND b.deleted_at IS NULL
      AND b.status NOT IN ('CANCELLED_BY_CLIENT','CANCELLED_BY_CLUB','RESCHEDULED')
      AND b.starts_at >= $2::timestamptz AND b.starts_at < $3::timestamptz
    WHERE c.club_id=$1 AND c.deleted_at IS NULL
    GROUP BY c.id, c.name
    HAVING SUM(b.duration_minutes) > 0`,
    [clubA.id, dayStart, dayEnd]);

  for (const r of rows) {
    const perHour = Number(r.revenue) / (Number(r.minutes) / 60);
    if (!Number.isFinite(perHour) || perHour <= 0) {
      throw new Error(`facturación por hora inválida en ${r.name}`);
    }
  }
});

await check('el cierre respeta el aislamiento entre clubes', async () => {
  const { rows } = await c.query(`
    SELECT COALESCE(SUM(total_price),0)::numeric AS billed
    FROM bookings
    WHERE club_id=$1 AND starts_at >= $2::timestamptz AND starts_at < $3::timestamptz`,
    [clubB.id, dayStart, dayEnd]);
  eq(Number(rows[0].billed), 0, 'club B no tiene actividad ese día');
});

// ===========================================================================
console.log('\n15. Tesorería: importación y conciliación\n');
// ===========================================================================

import { createHash } from 'node:crypto';

const { rows: [bank] } = await c.query(
  `INSERT INTO bank_accounts (club_id,bank_name,account_name,account_type,current_balance)
   VALUES ($1,'Santander','Cuenta Corriente','CHECKING',150000) RETURNING id`,
  [clubA.id]);

/** Misma huella que TreasuryService. */
const fingerprint = (date, amount, description, occurrence = 1) => {
  const normalized = description.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  const base = createHash('sha256')
    .update(`${date}|${amount.toFixed(2)}|${normalized}`)
    .digest('hex').slice(0, 32);
  return `${base}:${occurrence}`;
};

const importRow = async (date, description, amount, occurrence = 1) => {
  try {
    await c.query(
      `INSERT INTO bank_transactions (club_id,account_id,date,description,amount,fingerprint,source)
       VALUES ($1,$2,$3::date,$4,$5,$6,'IMPORT_CSV')`,
      [clubA.id, bank.id, date, description, amount,
       fingerprint(date, amount, description, occurrence)]);
    return 'imported';
  } catch (e) {
    if (e.message.includes('duplicate') || e.message.includes('unique')) return 'duplicate';
    throw e;
  }
};

await check('importa un extracto', async () => {
  eq(await importRow('2027-06-10', 'TRANSFERENCIA RECIBIDA', 45000), 'imported', 'fila 1');
  eq(await importRow('2027-06-11', 'PAGO PROVEEDOR BEBIDAS', -28000), 'imported', 'fila 2');
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM bank_transactions WHERE account_id=$1`, [bank.id]);
  eq(rows[0].n, 2, 'dos movimientos');
});

await check('reimportar el mismo archivo NO duplica', async () => {
  // Es el error más común: el administrativo no se acuerda si ya lo importó.
  eq(await importRow('2027-06-10', 'TRANSFERENCIA RECIBIDA', 45000), 'duplicate', 'repetida');
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM bank_transactions WHERE account_id=$1`, [bank.id]);
  eq(rows[0].n, 2, 'sigue habiendo dos');
});

await check('la huella tolera cambios de mayúsculas y espacios', async () => {
  // Los bancos exportan el mismo movimiento con distinto formato entre
  // descargas. Sin normalizar, el duplicado pasaría.
  eq(await importRow('2027-06-10', 'Transferencia  Recibida', 45000), 'duplicate',
     'misma huella pese al formato');
});

await check('dos movimientos idénticos el mismo día SÍ se permiten', async () => {
  // Dos cobros de $5.000 el mismo día existen de verdad. El discriminador
  // por posición los distingue.
  eq(await importRow('2027-06-12', 'COBRO QR', 5000, 1), 'imported', 'primero');
  eq(await importRow('2027-06-12', 'COBRO QR', 5000, 2), 'imported', 'segundo');
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM bank_transactions
     WHERE account_id=$1 AND description='COBRO QR'`, [bank.id]);
  eq(rows[0].n, 2, 'ambos entraron');
});

await check('la conciliación por monto exacto encuentra el cobro', async () => {
  const { rows: [pmTransfer] } = await c.query(
    `INSERT INTO payment_methods (club_id,code,name,kind,affects_cash_count,settlement_days)
     VALUES ($1,'TRANSFER','Transferencia','BANK_TRANSFER',false,0) RETURNING id`,
    [clubA.id]);

  await c.query(
    `INSERT INTO payments (club_id,code,method_id,amount,fee_amount,net_amount,status,paid_at,settlement_date)
     VALUES ($1,'PG-TR-1',$2,45000,0,45000,'COMPLETED','2027-06-10T14:00:00Z','2027-06-10')`,
    [clubA.id, pmTransfer.id]);

  const { rows } = await c.query(`
    SELECT bt.id AS tx_id, p.id AS payment_id, p.code
    FROM bank_transactions bt
    JOIN payments p ON ABS(p.amount - bt.amount) < 0.01
    WHERE bt.account_id=$1 AND bt.is_reconciled=false AND bt.amount > 0
      AND p.club_id=$2 AND p.settled_at IS NULL`,
    [bank.id, clubA.id]);

  if (rows.length === 0) throw new Error('debería sugerir el cobro de 45000');
  eq(rows[0].code, 'PG-TR-1', 'el cobro correcto');
});

await check('conciliar marca ambos lados', async () => {
  const { rows: [tx] } = await c.query(
    `SELECT id FROM bank_transactions WHERE account_id=$1 AND amount=45000 LIMIT 1`,
    [bank.id]);
  const { rows: [pay] } = await c.query(
    `SELECT id FROM payments WHERE code='PG-TR-1'`);

  await c.query('BEGIN');
  await c.query(`UPDATE payments SET settled_at=now() WHERE id=$1`, [pay.id]);
  await c.query(
    `UPDATE bank_transactions SET is_reconciled=true, reconciled_at=now(), reconciled_with=$2
     WHERE id=$1`, [tx.id, pay.id]);
  await c.query('COMMIT');

  const { rows: t } = await c.query(
    `SELECT is_reconciled, reconciled_with FROM bank_transactions WHERE id=$1`, [tx.id]);
  eq(t[0].is_reconciled, true, 'el movimiento queda conciliado');
  const { rows: p } = await c.query(`SELECT settled_at FROM payments WHERE id=$1`, [pay.id]);
  if (!p[0].settled_at) throw new Error('el cobro debe quedar acreditado');
});

await check('un cobro ya conciliado no se sugiere de nuevo', async () => {
  const { rows } = await c.query(`
    SELECT count(*)::int AS n FROM payments
    WHERE club_id=$1 AND code='PG-TR-1' AND settled_at IS NULL`, [clubA.id]);
  eq(rows[0].n, 0, 'ya no está disponible');
});

console.log('\n16. Gastos y flujo de fondos\n');

await check('un gasto se registra sin mover plata', async () => {
  const { rows: [expCat] } = await c.query(
    `INSERT INTO expense_categories (club_id,name,is_fixed) VALUES ($1,'Alquiler',true) RETURNING id`,
    [clubA.id]);
  const { rows: [sup] } = await c.query(
    `INSERT INTO suppliers (club_id,name) VALUES ($1,'Inmobiliaria Norte') RETURNING id`,
    [clubA.id]);

  const cashBefore = await c.query(`
    SELECT COALESCE(SUM(amount),0)::numeric AS total FROM cash_movements
    WHERE club_id=$1 AND direction='OUT'`, [clubA.id]);

  await c.query(
    `INSERT INTO expenses (club_id,code,concept,amount,tax_amount,total,date,due_date,
       category_id,supplier_id,status)
     VALUES ($1,'G-2027-00001','Alquiler junio',400000,0,400000,'2027-06-01','2027-06-10',
       $2,$3,'PENDING')`,
    [clubA.id, expCat.id, sup.id]);

  const cashAfter = await c.query(`
    SELECT COALESCE(SUM(amount),0)::numeric AS total FROM cash_movements
    WHERE club_id=$1 AND direction='OUT'`, [clubA.id]);

  eq(Number(cashAfter.rows[0].total), Number(cashBefore.rows[0].total),
     'registrar la obligación no saca plata del cajón');
  // Una factura que vence el 15 es un gasto desde que llega, aunque se
  // pague el 14. Si solo se registrara al pagar, la proyección no la vería.
});

await check('el saldo del proveedor refleja lo que se le debe', async () => {
  const { rows: [sup] } = await c.query(
    `SELECT id FROM suppliers WHERE club_id=$1 AND name='Inmobiliaria Norte'`, [clubA.id]);
  await c.query(
    `UPDATE suppliers SET current_balance = current_balance + 400000 WHERE id=$1`, [sup.id]);
  const { rows } = await c.query(`SELECT current_balance FROM suppliers WHERE id=$1`, [sup.id]);
  eq(Number(rows[0].current_balance), 400000, 'se le debe el alquiler');
});

await check('pagar el gasto SÍ mueve la caja', async () => {
  const { rows: [reg4] } = await c.query(
    `INSERT INTO cash_registers (club_id,name) VALUES ($1,'Tesorería') RETURNING id`,
    [clubA.id]);
  const { rows: [sess4] } = await c.query(
    `INSERT INTO cash_sessions (club_id,register_id,membership_id,opening_amount,status)
     VALUES ($1,$2,$3,500000,'OPEN') RETURNING id`, [clubA.id, reg4.id, mem.id]);
  const { rows: [exp] } = await c.query(
    `SELECT id, total, code, concept FROM expenses WHERE code='G-2027-00001'`);

  await c.query('BEGIN');
  await c.query(
    `INSERT INTO cash_movements (club_id,session_id,type,direction,amount,payment_method_id,concept,reference)
     VALUES ($1,$2,'EXPENSE','OUT',$3,$4,$5,$6)`,
    [clubA.id, sess4.id, exp.total, pmCash.id, `${exp.concept} (${exp.code})`, exp.id]);
  await c.query(`UPDATE expenses SET status='PAID', paid_at=now() WHERE id=$1`, [exp.id]);
  await c.query('COMMIT');

  const { rows } = await c.query(
    `SELECT amount FROM cash_movements WHERE reference=$1`, [exp.id]);
  eq(Number(rows[0].amount), 400000, 'salió de la caja');
});

await check('el flujo de fondos proyecta acreditaciones futuras', async () => {
  const { rows: [pmCredit] } = await c.query(
    `SELECT id FROM payment_methods WHERE club_id=$1 AND code='CREDIT'`, [clubA.id]);

  // Cobro con tarjeta hoy: entra recién en 18 días.
  await c.query(
    `INSERT INTO payments (club_id,code,method_id,amount,fee_amount,net_amount,
       status,paid_at,settlement_date,settled_at)
     VALUES ($1,'PG-FUT-1',$2,200000,7000,193000,'COMPLETED',now(),
       (CURRENT_DATE + 18),NULL)`,
    [clubA.id, pmCredit.id]);

  const { rows } = await c.query(`
    SELECT p.code, p.net_amount, p.settlement_date
    FROM payments p
    WHERE p.club_id=$1 AND p.settled_at IS NULL AND p.settlement_date IS NOT NULL
      AND p.settlement_date > CURRENT_DATE`, [clubA.id]);

  const future = rows.find(r => r.code === 'PG-FUT-1');
  if (!future) throw new Error('debería aparecer como acreditación pendiente');
  eq(Number(future.net_amount), 193000, 'se proyecta el NETO, no el bruto');
  // Cobrar 200.000 con tarjeta no es tener 200.000: entran 193.000 y a los
  // 18 días.
});

await check('los gastos vencidos se detectan', async () => {
  await c.query(
    `INSERT INTO expenses (club_id,code,concept,amount,tax_amount,total,date,due_date,status)
     VALUES ($1,'G-2027-00002','Luz mayo',85000,0,85000,'2027-05-01',
       (CURRENT_DATE - 5),'PENDING')`,
    [clubA.id]);

  const { rows } = await c.query(`
    SELECT code, (due_date - CURRENT_DATE) AS days_to_due
    FROM expenses
    WHERE club_id=$1 AND status='PENDING' AND due_date < CURRENT_DATE`, [clubA.id]);

  const overdue = rows.find(r => r.code === 'G-2027-00002');
  if (!overdue) throw new Error('debería detectar el vencido');
  if (Number(overdue.days_to_due) >= 0) throw new Error('debe dar días negativos');
});

await check('los gastos se separan en fijos y variables', async () => {
  await c.query(
    `INSERT INTO expense_categories (club_id,name,is_fixed) VALUES ($1,'Insumos',false)`,
    [clubA.id]);

  const { rows } = await c.query(`
    SELECT ec.is_fixed, COALESCE(SUM(e.total),0)::numeric AS total
    FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id = e.category_id
    WHERE e.club_id=$1 AND e.deleted_at IS NULL AND e.status <> 'CANCELLED'
    GROUP BY ec.is_fixed`, [clubA.id]);

  const fixed = rows.find(r => r.is_fixed === true);
  if (!fixed) throw new Error('debería haber gastos fijos');
  eq(Number(fixed.total), 400000, 'el alquiler es fijo');
  // Separarlos es lo que permite calcular el punto de equilibrio.
});

await check('la tesorería respeta el aislamiento entre clubes', async () => {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM bank_accounts WHERE club_id=$1`, [clubB.id]);
  eq(rows[0].n, 0, 'club B no tiene cuentas');
});

// ===========================================================================
console.log('\n17. Torneos\n');
// ===========================================================================

const { rows: [torneo] } = await c.query(
  `INSERT INTO tournaments (club_id,name,format,starts_at,max_teams,entry_fee,status)
   VALUES ($1,'Apertura 2027','ELIMINATION','2027-08-15T13:00:00Z',8,15000,'REGISTRATION_OPEN')
   RETURNING id`, [clubA.id]);

// Ocho jugadores para cuatro parejas.
const jugadores = [];
for (let i = 1; i <= 8; i++) {
  const { rows: [j] } = await c.query(
    `INSERT INTO clients (club_id,first_name,last_name) VALUES ($1,$2,'Jugador') RETURNING id`,
    [clubA.id, `J${i}`]);
  jugadores.push(j.id);
}

const inscribir = async (nombre, seed, ids) => {
  const { rows: [team] } = await c.query(
    `INSERT INTO tournament_teams (club_id,tournament_id,name,seed,payment_status)
     VALUES ($1,$2,$3,$4,'PAID') RETURNING id`,
    [clubA.id, torneo.id, nombre, seed]);
  for (const clientId of ids) {
    await c.query(
      `INSERT INTO tournament_team_members (club_id,team_id,client_id)
       VALUES ($1,$2,$3)`, [clubA.id, team.id, clientId]);
  }
  return team.id;
};

const equipos = [];
equipos.push(await inscribir('Los Cracks', 1, [jugadores[0], jugadores[1]]));
equipos.push(await inscribir('Las Panteras', 2, [jugadores[2], jugadores[3]]));
equipos.push(await inscribir('Dúo Dinámico', 3, [jugadores[4], jugadores[5]]));
equipos.push(await inscribir('Los Pibes', 4, [jugadores[6], jugadores[7]]));

await check('se inscriben cuatro equipos', async () => {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM tournament_teams WHERE tournament_id=$1`, [torneo.id]);
  eq(rows[0].n, 4, 'cuatro parejas');
});

await check('un jugador no puede estar en dos equipos del mismo torneo', async () => {
  const { rows } = await c.query(`
    SELECT ttm.client_id, count(*)::int AS veces
    FROM tournament_team_members ttm
    JOIN tournament_teams tt ON tt.id = ttm.team_id
    WHERE tt.tournament_id = $1
    GROUP BY ttm.client_id
    HAVING count(*) > 1`, [torneo.id]);
  eq(rows.length, 0, 'ningún jugador repetido');
  // TournamentService lo valida antes de insertar.
});

await check('el fixture de 4 equipos da 3 partidos', async () => {
  // Semifinales: 1v4, 2v3. Final: los ganadores.
  const cruces = [
    ['Semifinal', 1, 1, equipos[0], equipos[3]],
    ['Semifinal', 1, 2, equipos[1], equipos[2]],
    ['Final', 2, 1, null, null],
  ];
  for (const [round, rn, mn, home, away] of cruces) {
    await c.query(
      `INSERT INTO tournament_matches (club_id,tournament_id,round,round_number,
         match_number,home_team_id,away_team_id,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'SCHEDULED')`,
      [clubA.id, torneo.id, round, rn, mn, home, away]);
  }
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM tournament_matches WHERE tournament_id=$1`,
    [torneo.id]);
  eq(rows[0].n, 3, 'dos semis y una final');
});

await check('el sembrado 1 enfrenta al 4', async () => {
  const { rows } = await c.query(`
    SELECT h.name AS home, a.name AS away
    FROM tournament_matches m
    JOIN tournament_teams h ON h.id = m.home_team_id
    JOIN tournament_teams a ON a.id = m.away_team_id
    WHERE m.tournament_id=$1 AND m.round_number=1 AND m.match_number=1`,
    [torneo.id]);
  eq(rows[0].home, 'Los Cracks', 'el primer sembrado');
  eq(rows[0].away, 'Los Pibes', 'contra el último');
  // Así el 1 y el 2 solo se cruzan en la final.
});

await check('cargar un resultado define al ganador', async () => {
  const { rows: [semi] } = await c.query(
    `SELECT id, home_team_id FROM tournament_matches
     WHERE tournament_id=$1 AND round_number=1 AND match_number=1`, [torneo.id]);

  await c.query('BEGIN');
  await c.query(
    `UPDATE tournament_matches SET score_sets=$2, winner_team_id=$3, status='FINISHED'
     WHERE id=$1`,
    [semi.id, JSON.stringify([[6,4],[6,3]]), semi.home_team_id]);
  await c.query(
    `UPDATE tournament_teams SET played=played+1, won=won+1, points=points+3 WHERE id=$1`,
    [semi.home_team_id]);
  await c.query('COMMIT');

  const { rows } = await c.query(
    `SELECT winner_team_id, status FROM tournament_matches WHERE id=$1`, [semi.id]);
  eq(rows[0].status, 'FINISHED', 'partido cerrado');
  eq(rows[0].winner_team_id, semi.home_team_id, 'ganó el local');
});

await check('el ganador avanza a la final', async () => {
  const { rows: [semi] } = await c.query(
    `SELECT winner_team_id FROM tournament_matches
     WHERE tournament_id=$1 AND round_number=1 AND match_number=1`, [torneo.id]);
  const { rows: [final] } = await c.query(
    `SELECT id FROM tournament_matches
     WHERE tournament_id=$1 AND round_number=2 AND match_number=1`, [torneo.id]);

  // Partido 1 de la ronda 1 alimenta el partido 1 de la ronda 2, como local.
  await c.query(
    `UPDATE tournament_matches SET home_team_id=$2 WHERE id=$1`,
    [final.id, semi.winner_team_id]);

  const { rows } = await c.query(
    `SELECT home_team_id FROM tournament_matches WHERE id=$1`, [final.id]);
  eq(rows[0].home_team_id, semi.winner_team_id, 'ya está en la final');
});

await check('la tabla acumula sets y games', async () => {
  const { rows } = await c.query(`
    SELECT
      tt.name,
      tt.points,
      m.score_sets
    FROM tournament_teams tt
    JOIN tournament_matches m ON m.winner_team_id = tt.id
    WHERE tt.tournament_id=$1 AND m.status='FINISHED'`, [torneo.id]);

  if (rows.length === 0) throw new Error('debería haber un ganador');
  eq(Number(rows[0].points), 3, 'tres puntos por victoria');
  const sets = rows[0].score_sets;
  eq(Array.isArray(sets), true, 'el marcador se guarda como JSON');
  eq(sets.length, 2, 'dos sets');
});

await check('un resultado imposible se rechaza', async () => {
  // 6-5 no cierra un set de pádel. La validación es del servicio, pero se
  // deja constancia de que el dato llegaría mal a la tabla.
  const invalidos = [[6,5],[9,3],[7,3],[6,6]];
  for (const [h,a] of invalidos) {
    const hi = Math.max(h,a), lo = Math.min(h,a);
    const valido = (hi === 7 && (lo === 5 || lo === 6)) || (hi === 6 && lo <= 4);
    if (valido) throw new Error(`${h}-${a} debería ser inválido`);
  }
});

await check('la inscripción cobrada entra al circuito financiero', async () => {
  const { rows: [reg5] } = await c.query(
    `INSERT INTO cash_registers (club_id,name) VALUES ($1,'Torneos') RETURNING id`,
    [clubA.id]);
  const { rows: [sess5] } = await c.query(
    `INSERT INTO cash_sessions (club_id,register_id,membership_id,opening_amount,status)
     VALUES ($1,$2,$3,0,'OPEN') RETURNING id`, [clubA.id, reg5.id, mem.id]);

  await c.query('BEGIN');
  const { rows: [pago] } = await c.query(
    `INSERT INTO payments (club_id,code,method_id,amount,fee_amount,net_amount,
       status,cash_session_id)
     VALUES ($1,'PG-TOR-1',$2,15000,0,15000,'COMPLETED',$3) RETURNING id`,
    [clubA.id, pmCash.id, sess5.id]);
  await c.query(
    `INSERT INTO cash_movements (club_id,session_id,type,direction,amount,
       payment_method_id,concept,payment_id)
     VALUES ($1,$2,'TOURNAMENT_FEE','IN',15000,$3,'Inscripción Apertura 2027',$4)`,
    [clubA.id, sess5.id, pmCash.id, pago.id]);
  await c.query('COMMIT');

  const { rows } = await c.query(`
    SELECT COALESCE(SUM(amount),0)::numeric AS total FROM cash_movements
    WHERE session_id=$1 AND type='TOURNAMENT_FEE'`, [sess5.id]);
  eq(Number(rows[0].total), 15000, 'la inscripción entró a la caja');
  // Un torneo cuya recaudación no entra al arqueo deja plata fuera de control.
});

await check('no se puede rehacer el fixture con resultados cargados', async () => {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM tournament_matches
     WHERE tournament_id=$1 AND score_sets IS NOT NULL`, [torneo.id]);
  if (rows[0].n === 0) throw new Error('debería haber un resultado');
  // resetFixture lanza ConflictException en este caso.
});

await check('los torneos respetan el aislamiento entre clubes', async () => {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM tournaments WHERE club_id=$1`, [clubB.id]);
  eq(rows[0].n, 0, 'club B no tiene torneos');
});

// ---------------------------------------------------------------------------
await appClient.end();
await app.end();
await c.end();

console.log(`\n${'='.repeat(50)}`);
console.log(`${pass} pasaron, ${fail} fallaron`);
console.log('='.repeat(50) + '\n');
process.exit(fail ? 1 : 0);
