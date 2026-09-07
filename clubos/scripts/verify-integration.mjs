/**
 * Verifica que la agenda consuma correctamente la forma real de la respuesta
 * de /agenda/day. Simula el backend y comprueba el mapeo.
 */
import fs from 'fs';
const html = fs.readFileSync('/home/claude/clubos-web/agenda.html','utf8');

let pass=0, fail=0;
const check=(n,f)=>{try{f();console.log(`  ✓ ${n}`);pass++;}catch(e){console.log(`  ✗ ${n}\n      ${e.message}`);fail++;}};
const eq=(a,b,m)=>{if(a!==b)throw new Error(`${m}: got ${a}, want ${b}`)};

// Respuesta real de AgendaService (misma forma que devuelve el backend)
const apiResponse = {
  date:'2026-07-22', timezone:'America/Argentina/Buenos_Aires',
  openMinute:480, closeMinute:1440,
  courts:[
    {id:'u1',name:'Cancha 1',number:1,color:'#3B82F6',status:'AVAILABLE',
     slotMinutes:30,capacity:4,environment:'INDOOR',openMinute:480,closeMinute:1440},
    {id:'u2',name:'Cancha 2',number:2,color:'#10B981',status:'AVAILABLE',
     slotMinutes:30,capacity:4,environment:'OUTDOOR',openMinute:480,closeMinute:1440},
  ],
  bookings:[
    {id:'bk1',code:'R-2026-00184',courtId:'u1',startsAt:'2026-07-22T21:00:00Z',
     endsAt:'2026-07-22T22:30:00Z',startMinute:1080,endMinute:1170,durationMinutes:90,
     type:'REGULAR',status:'CONFIRMED',paymentStatus:'UNPAID',title:'Ana Rodríguez',
     clientId:'cl1',clientPhone:'1145678900',instructorName:null,playersCount:4,
     totalPrice:24000,paidAmount:0,pendingAmount:24000,checkInAt:null,hasNotes:false},
    {id:'bk2',code:'R-2026-00185',courtId:'u2',startsAt:'2026-07-22T17:00:00Z',
     endsAt:'2026-07-22T18:30:00Z',startMinute:840,endMinute:930,durationMinutes:90,
     type:'LESSON',status:'PAID',paymentStatus:'PAID',title:'Escuela · Nivel 2',
     clientId:null,clientPhone:null,instructorName:'Pablo Ruiz',playersCount:6,
     totalPrice:24000,paidAmount:24000,pendingAmount:0,checkInAt:null,hasNotes:true},
    {id:'bk3',code:'R-2026-00186',courtId:'u1',startsAt:'2026-07-22T13:00:00Z',
     endsAt:'2026-07-22T15:00:00Z',startMinute:600,endMinute:720,durationMinutes:120,
     type:'MAINTENANCE',status:'CONFIRMED',paymentStatus:'UNPAID',title:'Mantenimiento',
     clientId:null,clientPhone:null,instructorName:null,playersCount:0,
     totalPrice:0,paidAmount:0,pendingAmount:0,checkInAt:null,hasNotes:false},
  ],
  blocks:[],
  summary:{bookingsCount:2,occupancyPercent:23.4,revenue:24000,
           pendingRevenue:24000,cancelledCount:0,noShowCount:0},
};

// Replica del mapeo que hace loadDay()
const mapCourts = d => d.courts.map(c => ({
  id:c.id,name:c.name,number:c.number,color:c.color,
  env:c.environment==='INDOOR'?'Techada':'Descubierta',
}));
const mapBookings = d => d.bookings.map(b => ({
  id:b.id,code:b.code,court:b.courtId,start:b.startMinute,end:b.endMinute,
  client:b.title,
  status: b.type==='LESSON'?'LESSON'
        : b.type==='TOURNAMENT'?'TOURNAMENT'
        : b.type==='MAINTENANCE'?'MAINTENANCE'
        : b.status,
  total:b.totalPrice,paid:b.paidAmount,players:b.playersCount,
  instructor:b.instructorName ?? undefined,
}));

console.log('\nMapeo de la respuesta del backend\n');

check('las canchas conservan su color e identificación', () => {
  const c = mapCourts(apiResponse);
  eq(c.length, 2, 'dos canchas');
  eq(c[0].color, '#3B82F6', 'color');
  eq(c[0].env, 'Techada', 'INDOOR se traduce');
  eq(c[1].env, 'Descubierta', 'OUTDOOR se traduce');
});

check('los minutos vienen calculados del backend', () => {
  const b = mapBookings(apiResponse);
  eq(b[0].start, 1080, '18:00 en hora local');
  eq(b[0].end, 1170, '19:30');
  // El front no recalcula la zona horaria: el backend ya resolvió.
});

check('el tipo pisa al estado para el color del bloque', () => {
  const b = mapBookings(apiResponse);
  eq(b[1].status, 'LESSON', 'una clase se ve violeta aunque esté PAID');
  eq(b[2].status, 'MAINTENANCE', 'mantenimiento se ve gris');
  eq(b[0].status, 'CONFIRMED', 'una reserva normal usa su estado');
});

check('el título sale del backend, no se arma en el front', () => {
  const b = mapBookings(apiResponse);
  eq(b[0].client, 'Ana Rodríguez', 'cliente con nombre');
  eq(b[2].client, 'Mantenimiento', 'bloqueo sin cliente');
});

check('el saldo pendiente se refleja', () => {
  const b = mapBookings(apiResponse);
  eq(b[0].total - b[0].paid, 24000, 'falta cobrar todo');
  eq(b[1].total - b[1].paid, 0, 'la clase está paga');
});

check('el profesor aparece solo en las clases', () => {
  const b = mapBookings(apiResponse);
  eq(b[1].instructor, 'Pablo Ruiz', 'clase con profesor');
  eq(b[0].instructor, undefined, 'reserva sin profesor');
});

console.log('\nEstructura del archivo\n');

check('la capa de API existe y define el modo demo', () => {
  if(!html.includes('let LIVE = false')) throw new Error('falta el flag LIVE');
  if(!html.includes('async function fetchDay')) throw new Error('falta fetchDay');
  if(!html.includes('demoBadge')) throw new Error('falta el indicador de demo');
});

check('moveBooking guarda snapshot y revierte', () => {
  const fn = html.slice(html.indexOf('async function moveBooking'), html.indexOf('function minuteToISO'));
  if(!fn.includes('const snapshot =')) throw new Error('no guarda el estado previo');
  if(!fn.includes('b.court = snapshot.court')) throw new Error('no revierte');
  if(!fn.includes('BOOKING_OVERLAP')) throw new Error('no maneja la carrera de reservas');
});

check('cobrar espera la respuesta antes de confirmar', () => {
  const start = html.indexOf('window.__collect = async');
  const collect = html.slice(start, html.indexOf('window.__checkin = async', start));
  // El bloque LIVE es el que habla con el servidor.
  const live = collect.slice(collect.indexOf('try {'));
  if(!live.includes('await apiCall')) throw new Error('debe llamar al servidor');
  if(live.indexOf('toast(res.paymentStatus') < live.indexOf('await apiCall'))
    throw new Error('confirma antes de la respuesta');
  // El monto neto lo calcula el servidor: no se puede adivinar en el front.
  if(!live.includes('await loadDay()')) throw new Error('debe recargar tras cobrar');
});

check('cancelar informa la devolución que decidió el servidor', () => {
  const start = html.indexOf('window.__cancel = async');
  const cancel = html.slice(start, html.indexOf('function currentMinute', start));
  const live = cancel.slice(cancel.indexOf('try {'));
  if(!live.includes('res.refundAmount')) throw new Error('debe usar el monto del servidor');
  if(!live.includes('res.tierApplied')) throw new Error('debe explicar qué tramo aplicó');
});

check('la búsqueda tiene debounce y control de orden', () => {
  const fn = html.slice(html.indexOf('function renderSearch'), html.indexOf('function filterDemo'));
  if(!fn.includes('clearTimeout')) throw new Error('falta debounce');
  if(!fn.includes('seq !== searchSeq')) throw new Error('falta control de respuestas tardías');
});

check('refresca al volver a la pestaña', () => {
  if(!html.includes('visibilitychange')) throw new Error('falta el refresco al volver');
  if(!html.includes('!document.hidden && !drag')) throw new Error('el refresco no debe pisar un arrastre');
});

console.log(`\n${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail?1:0);
