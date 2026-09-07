/**
 * Verificación de la lógica del store: optimismo, reversión y carreras.
 * Replica el algoritmo con un backend simulado.
 */
let pass=0, fail=0;
const check=async(n,f)=>{try{await f();console.log(`  ✓ ${n}`);pass++;}catch(e){console.log(`  ✗ ${n}\n      ${e.message}`);fail++;}};
const eq=(a,b,m)=>{if(a!==b)throw new Error(`${m}: got ${a}, want ${b}`)};

class ApiError extends Error {
  constructor(status, code, msg){ super(msg); this.status=status; this.code=code; }
  get isOverlap(){ return this.code==='BOOKING_OVERLAP'; }
}

// --- store simplificado con la misma lógica ---
class Store {
  constructor(server){
    this.server = server;
    this.state = { date:'2026-07-22', day:null, loading:false, selectedId:null, pending:new Set() };
    this.loadToken = 0;
  }
  async load(date = this.state.date){
    const token = ++this.loadToken;
    this.state.loading = true;
    const day = await this.server.getDay(date);
    if (token !== this.loadToken) return 'descartada';
    this.state = { ...this.state, date, day, loading:false };
    return 'aplicada';
  }
  findConflict(ignoreId, courtId, s, e){
    return this.state.day?.bookings.find(b =>
      b.id!==ignoreId && b.courtId===courtId &&
      !b.status.startsWith('CANCELLED') && b.status!=='NO_SHOW' &&
      s < b.endMinute && e > b.startMinute);
  }
  applyLocal(id, ch){
    this.state.day.bookings = this.state.day.bookings.map(b => b.id===id ? {...b,...ch} : b);
  }
  async moveBooking(id, courtId, startMinute){
    const day = this.state.day;
    const original = day.bookings.find(b=>b.id===id);
    if(!original) return {ok:false, message:'no existe'};
    const endMinute = startMinute + original.durationMinutes;

    const conflict = this.findConflict(id, courtId, startMinute, endMinute);
    if(conflict) return {ok:false, message:`ocupado por ${conflict.title}`, local:true};
    if(startMinute < day.openMinute || endMinute > day.closeMinute)
      return {ok:false, message:'fuera de horario', local:true};

    const snapshot = {...original};
    this.applyLocal(id, {courtId, startMinute, endMinute});

    try {
      await this.server.reschedule(id, courtId, startMinute);
      await this.load(day.date);
      return {ok:true, message:'movido'};
    } catch(e){
      this.applyLocal(id, {
        courtId: snapshot.courtId,
        startMinute: snapshot.startMinute,
        endMinute: snapshot.endMinute,
      });
      if(e.isOverlap){ await this.load(day.date); return {ok:false, message:'alguien reservó', reloaded:true}; }
      return {ok:false, message:e.message};
    }
  }
}

// --- servidor simulado ---
function makeServer(bookings, opts={}){
  const state = { bookings: bookings.map(b=>({...b})), calls: [] };
  return {
    state,
    async getDay(date){
      state.calls.push(['getDay', date]);
      if (opts.loadDelay) await new Promise(r=>setTimeout(r, opts.loadDelay[date] ?? 0));
      return {
        date, timezone:'America/Argentina/Buenos_Aires',
        openMinute:480, closeMinute:1440,
        courts:[{id:'c1',name:'Cancha 1'},{id:'c2',name:'Cancha 2'}],
        bookings: state.bookings.filter(b=>b.date===date).map(b=>({...b})),
      };
    },
    async reschedule(id, courtId, startMinute){
      state.calls.push(['reschedule', id, courtId, startMinute]);
      if (opts.failWith) throw opts.failWith;
      const b = state.bookings.find(x=>x.id===id);
      b.courtId = courtId;
      b.startMinute = startMinute;
      b.endMinute = startMinute + b.durationMinutes;
      return {newBookingId:'nuevo-'+id};
    },
  };
}

const bk = (id, courtId, s, dur, title, status='CONFIRMED') => ({
  id, courtId, startMinute:s, endMinute:s+dur, durationMinutes:dur,
  title, status, date:'2026-07-22',
});

(async () => {
console.log('\nMover un turno: camino feliz\n');

await check('el bloque se mueve y el servidor confirma', async () => {
  const srv = makeServer([bk('b1','c1',1080,90,'Ana')]);
  const st = new Store(srv); await st.load();
  const r = await st.moveBooking('b1','c2',1200);
  eq(r.ok, true, 'debería funcionar');
  const b = st.state.day.bookings.find(x=>x.id==='b1');
  eq(b.courtId, 'c2', 'cancha nueva');
  eq(b.startMinute, 1200, 'horario nuevo');
});

await check('recarga después de mover (el id cambia en el backend)', async () => {
  const srv = makeServer([bk('b1','c1',1080,90,'Ana')]);
  const st = new Store(srv); await st.load();
  srv.state.calls.length = 0;
  await st.moveBooking('b1','c2',1200);
  const reloads = srv.state.calls.filter(c=>c[0]==='getDay').length;
  if(reloads < 1) throw new Error('tiene que recargar: reprogramar crea otra reserva');
});

console.log('\nValidación local: no viaja al servidor\n');

await check('choque con otro turno se detecta sin request', async () => {
  const srv = makeServer([bk('b1','c1',1080,90,'Ana'), bk('b2','c2',1200,90,'Beto')]);
  const st = new Store(srv); await st.load();
  srv.state.calls.length = 0;
  const r = await st.moveBooking('b1','c2',1230);   // pisa a Beto
  eq(r.ok, false, 'debe rechazar');
  eq(r.local, true, 'rechazo local');
  eq(srv.state.calls.length, 0, 'no debe llamar al servidor');
  if(!r.message.includes('Beto')) throw new Error('debe decir quién ocupa');
});

await check('fuera del horario de apertura se rechaza local', async () => {
  const srv = makeServer([bk('b1','c1',1080,90,'Ana')]);
  const st = new Store(srv); await st.load();
  srv.state.calls.length = 0;
  const r = await st.moveBooking('b1','c1',1400);   // termina 00:50
  eq(r.ok, false, 'rechaza');
  eq(srv.state.calls.length, 0, 'sin request');
});

await check('turno consecutivo SÍ se permite', async () => {
  const srv = makeServer([bk('b1','c1',1080,90,'Ana'), bk('b2','c2',1200,90,'Beto')]);
  const st = new Store(srv); await st.load();
  const r = await st.moveBooking('b1','c2',1110);  // 18:30-20:00, Beto arranca 20:00
  eq(r.ok, true, 'consecutivo no es solapamiento');
});

await check('una reserva cancelada no bloquea el horario', async () => {
  const srv = makeServer([
    bk('b1','c1',1080,90,'Ana'),
    bk('b2','c2',1080,90,'Beto','CANCELLED_BY_CLIENT'),
  ]);
  const st = new Store(srv); await st.load();
  const r = await st.moveBooking('b1','c2',1080);
  eq(r.ok, true, 'el horario está libre');
});

console.log('\nReversión cuando el servidor rechaza\n');

await check('el bloque vuelve a su lugar exacto', async () => {
  const srv = makeServer([bk('b1','c1',1080,90,'Ana')], {
    failWith: new ApiError(500,'DB_ERROR','error del servidor'),
  });
  const st = new Store(srv); await st.load();
  const r = await st.moveBooking('b1','c2',1200);
  eq(r.ok, false, 'falla');
  const b = st.state.day.bookings.find(x=>x.id==='b1');
  eq(b.courtId, 'c1', 'vuelve a la cancha original');
  eq(b.startMinute, 1080, 'y al horario original');
  eq(b.endMinute, 1170, 'con su duración intacta');
});

await check('un 409 de solapamiento revierte Y recarga', async () => {
  const srv = makeServer([bk('b1','c1',1080,90,'Ana')], {
    failWith: new ApiError(409,'BOOKING_OVERLAP','ocupado'),
  });
  const st = new Store(srv); await st.load();
  const r = await st.moveBooking('b1','c2',1200);
  eq(r.ok, false, 'falla');
  eq(r.reloaded, true, 'debe recargar para mostrar lo que apareció');
  if(!r.message.includes('reservó')) throw new Error('debe explicar la carrera');
});

await check('el estado queda consistente tras varias fallas', async () => {
  const srv = makeServer([bk('b1','c1',1080,90,'Ana')], {
    failWith: new ApiError(500,'X','error'),
  });
  const st = new Store(srv); await st.load();
  await st.moveBooking('b1','c2',1200);
  await st.moveBooking('b1','c2',1230);
  await st.moveBooking('b1','c1',900);
  const b = st.state.day.bookings.find(x=>x.id==='b1');
  eq(b.courtId, 'c1', 'sigue en su lugar');
  eq(b.startMinute, 1080, 'sin corrimiento acumulado');
});

console.log('\nCarreras de carga\n');

await check('cambiar de día rápido descarta la respuesta vieja', async () => {
  const srv = makeServer([], { loadDelay: {'2026-07-22':60, '2026-07-23':0} });
  const st = new Store(srv);
  const lento = st.load('2026-07-22');   // tarda 60ms
  await new Promise(r=>setTimeout(r,5));
  const rapido = st.load('2026-07-23');  // responde ya
  const [r1, r2] = await Promise.all([lento, rapido]);
  eq(r1, 'descartada', 'la vieja se descarta');
  eq(r2, 'aplicada', 'la nueva se aplica');
  eq(st.state.date, '2026-07-23', 'queda el día correcto');
});

await check('la última carga siempre gana, sin importar el orden', async () => {
  const srv = makeServer([], { loadDelay: {'2026-07-22':40,'2026-07-23':20,'2026-07-24':0} });
  const st = new Store(srv);
  const a = st.load('2026-07-22'), b = st.load('2026-07-23'), c = st.load('2026-07-24');
  await Promise.all([a,b,c]);
  eq(st.state.date, '2026-07-24', 'gana la última pedida');
});

console.log(`\n${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail?1:0);
})();
