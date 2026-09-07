/**
 * Verificación de los algoritmos puros de agenda:
 *   - detección de solapamiento de intervalos
 *   - especificidad de reglas de precio
 *
 * Replica la lógica de availability.service.ts y pricing.service.ts para
 * probarla sin Postgres. Si cambia el algoritmo allá, cambiar acá.
 */

let pass = 0, fail = 0;
const check = (n, f) => {
  try { f(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${a}, want ${b}`); };

// ---------------------------------------------------------------------------
// Solapamiento: [start, end) — mismo criterio que tstzrange '[)'
// ---------------------------------------------------------------------------
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

console.log('\nDetección de solapamiento\n');

check('turnos consecutivos NO se solapan', () => {
  // 18:00-19:30 y 19:30-21:00
  eq(overlaps(1080, 1170, 1170, 1260), false, 'consecutivos');
});

check('solapamiento parcial al inicio', () => {
  // 18:00-19:30 vs 19:00-20:30  <- el bug de PadelPRO
  eq(overlaps(1080, 1170, 1140, 1230), true, 'parcial');
});

check('solapamiento parcial al final', () => {
  eq(overlaps(1140, 1230, 1080, 1170), true, 'parcial inverso');
});

check('turno contenido dentro de otro', () => {
  eq(overlaps(1100, 1140, 1080, 1200), true, 'contenido');
});

check('turno que contiene a otro', () => {
  eq(overlaps(1080, 1200, 1100, 1140), true, 'contenedor');
});

check('turnos idénticos se solapan', () => {
  eq(overlaps(1080, 1170, 1080, 1170), true, 'idénticos');
});

check('turnos disjuntos no se solapan', () => {
  eq(overlaps(600, 690, 1080, 1170), false, 'disjuntos');
});

check('turno que cruza medianoche bloquea el día siguiente', () => {
  // 23:30-01:00 expresado como 1410-1500 respecto del día base
  const cruza = { start: 1410, end: 1500 };
  // 00:30-02:00 del día siguiente = -1410 a -1320 respecto de ESE día...
  // pero en el día base equivale a 1470-1560
  eq(overlaps(cruza.start, cruza.end, 1470, 1560), true, 'cruce de medianoche');
  eq(overlaps(cruza.start, cruza.end, 1500, 1590), false, 'justo después');
});

// ---------------------------------------------------------------------------
// Generación de slots
// ---------------------------------------------------------------------------
function buildSlots(open, close, step, duration, occupied) {
  const out = [];
  for (let m = open; m + duration <= close; m += step) {
    const end = m + duration;
    const hit = occupied.find((o) => m < o.end && end > o.start);
    out.push({ start: m, end, available: !hit, reason: hit?.kind });
  }
  return out;
}

console.log('\nGeneración de slots\n');

check('slots respetan el paso y no exceden el cierre', () => {
  const s = buildSlots(480, 1440, 30, 90, []);
  eq(s[0].start, 480, 'primer slot');
  eq(s[0].end, 570, 'duración');
  eq(s[1].start, 510, 'paso de 30');
  const last = s[s.length - 1];
  if (last.end > 1440) throw new Error(`último slot excede cierre: ${last.end}`);
  eq(last.end, 1440, 'último llega justo al cierre');
});

check('una reserva bloquea todos los slots que toca', () => {
  const occ = [{ start: 1140, end: 1230, kind: 'BOOKED' }]; // 19:00-20:30
  const s = buildSlots(480, 1440, 30, 90, occ);
  // Slots de 90min que tocan 19:00-20:30: los que empiezan 17:30..20:00
  const blocked = s.filter((x) => !x.available).map((x) => x.start);
  eq(blocked.includes(1050), false, '17:30-19:00 es consecutivo, no se solapa');
  eq(blocked.includes(1080), true, '18:00-19:30 se solapa');
  eq(blocked.includes(1140), true, '19:00-20:30 exacto');
  eq(blocked.includes(1200), true, '20:00-21:30 se solapa');
  eq(blocked.includes(1230), false, '20:30-22:00 libre (consecutivo)');
});

check('slot que termina justo cuando arranca la reserva queda libre', () => {
  const occ = [{ start: 1170, end: 1260, kind: 'BOOKED' }]; // 19:30-21:00
  const s = buildSlots(480, 1440, 30, 90, occ);
  const slot = s.find((x) => x.start === 1080); // 18:00-19:30
  eq(slot.available, true, 'debería estar libre');
});

check('bloqueo de mantenimiento marca reason correcto', () => {
  const occ = [{ start: 600, end: 720, kind: 'BLOCKED' }];
  const s = buildSlots(480, 1440, 30, 60, occ);
  const slot = s.find((x) => x.start === 600);
  eq(slot.reason, 'BLOCKED', 'motivo');
});

check('sin horario disponible no hay slots', () => {
  eq(buildSlots(480, 540, 30, 90, []).length, 0, 'ventana menor a la duración');
});

// ---------------------------------------------------------------------------
// Especificidad de reglas de precio
// ---------------------------------------------------------------------------
function specificity(r) {
  let s = 0;
  if (r.courtId != null) s += 8;
  if (r.fromMinute != null || r.toMinute != null) s += 4;
  if (r.dayOfWeek != null) s += 2;
  if (r.bookingType != null) s += 1;
  if (r.durationMinutes != null) s += 1;
  return s;
}

function pick(rules) {
  return [...rules].sort(
    (a, b) => specificity(b) - specificity(a) || b.priority - a.priority || a.id.localeCompare(b.id)
  )[0];
}

const R = (id, o = {}) => ({
  id, courtId: null, dayOfWeek: null, fromMinute: null, toMinute: null,
  durationMinutes: null, bookingType: null, priority: 0, ...o,
});

console.log('\nEspecificidad de precios\n');

check('regla con cancha gana a regla general', () => {
  const w = pick([R('a', { durationMinutes: 90, price: 18000 }),
                  R('b', { courtId: 'c1', durationMinutes: 90, price: 22000 })]);
  eq(w.id, 'b', 'ganador');
});

check('ventana horaria gana a día de semana', () => {
  const w = pick([R('dia', { dayOfWeek: 6, durationMinutes: 90 }),
                  R('pico', { fromMinute: 1080, toMinute: 1440, durationMinutes: 90 })]);
  eq(w.id, 'pico', 'ventana(4) > día(2)');
});

check('cancha sola gana a ventana+día+tipo combinados', () => {
  // 8 > 4+2+1 = 7. Los pesos son potencias de 2 justamente para esto.
  const w = pick([
    R('combo', { fromMinute: 1080, toMinute: 1440, dayOfWeek: 6, bookingType: 'REGULAR' }),
    R('cancha', { courtId: 'c1' }),
  ]);
  eq(w.id, 'cancha', 'cancha domina');
});

check('priority desempata igual especificidad', () => {
  const w = pick([R('normal', { dayOfWeek: 6, priority: 0 }),
                  R('promo', { dayOfWeek: 6, priority: 10 })]);
  eq(w.id, 'promo', 'mayor prioridad');
});

check('desempate final es determinista', () => {
  const a = [R('zzz', { dayOfWeek: 6 }), R('aaa', { dayOfWeek: 6 })];
  eq(pick(a).id, pick([...a].reverse()).id, 'mismo ganador sin importar orden');
  eq(pick(a).id, 'aaa', 'gana el id menor');
});

check('regla más específica gana aunque tenga priority menor', () => {
  // La especificidad manda; priority solo desempata.
  const w = pick([R('general', { priority: 99 }),
                  R('especifica', { courtId: 'c1', priority: 0 })]);
  eq(w.id, 'especifica', 'especificidad > priority');
});

// ---------------------------------------------------------------------------
// Ventana horaria
// ---------------------------------------------------------------------------
function matchesWindow(r, minuteOfDay) {
  if (r.fromMinute == null && r.toMinute == null) return true;
  const from = r.fromMinute ?? 0;
  const to = r.toMinute ?? 1440;
  return minuteOfDay >= from && minuteOfDay < to;
}

console.log('\nVentana horaria\n');

check('regla sin ventana aplica siempre', () => {
  eq(matchesWindow(R('x'), 600), true, 'mañana');
  eq(matchesWindow(R('x'), 1300), true, 'noche');
});

check('ventana pico 18-24 aplica solo de noche', () => {
  const r = R('p', { fromMinute: 1080, toMinute: 1440 });
  eq(matchesWindow(r, 600), false, '10:00 fuera');
  eq(matchesWindow(r, 1080), true, '18:00 borde inclusivo');
  eq(matchesWindow(r, 1200), true, '20:00 dentro');
  eq(matchesWindow(r, 1439), true, '23:59 dentro');
});

check('borde superior es exclusivo', () => {
  const r = R('p', { fromMinute: 600, toMinute: 1080 });
  eq(matchesWindow(r, 1079), true, '17:59 dentro');
  eq(matchesWindow(r, 1080), false, '18:00 fuera (exclusivo)');
});

console.log(`\n${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail ? 1 : 0);
