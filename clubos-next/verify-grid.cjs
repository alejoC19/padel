const G = require('/tmp/gjs/grid.js');
let pass=0, fail=0;
const check=(n,f)=>{try{f();console.log(`  ✓ ${n}`);pass++;}catch(e){console.log(`  ✗ ${n}\n      ${e.message}`);fail++;}};
const eq=(a,b,m)=>{if(a!==b)throw new Error(`${m}: got ${a}, want ${b}`);};

const WIN = { openMinute: 480, closeMinute: 1440 };

console.log('\nGeometría\n');
check('apertura está en y=0', () => eq(G.minuteToY(480, WIN), 0, 'y'));
check('una hora después = 84px', () => eq(G.minuteToY(540, WIN), 84, '60*1.4'));
check('minuteToY y yToMinute son inversos', () => {
  for (const m of [480, 600, 1080, 1439]) {
    eq(Math.round(G.yToMinute(G.minuteToY(m, WIN), WIN)), m, `roundtrip ${m}`);
  }
});
check('snap a 30 minutos', () => {
  eq(G.snapMinute(1094, 30), 1080, '18:14 -> 18:00');
  eq(G.snapMinute(1096, 30), 1110, '18:16 -> 18:30');
});
check('altura total de la grilla', () => {
  eq(G.gridHeight(WIN), 960*1.4, '16 horas');
});
check('bloque corto respeta altura mínima legible', () => {
  const g = G.blockGeometry(600, 610, WIN); // 10 min = 14px
  if (g.height < 26) throw new Error(`altura ${g.height} ilegible`);
});

console.log('\nSolapamiento\n');
const item = (s,e,id) => ({startMinute:s, endMinute:e, id});

check('sin solapamiento: todos ancho completo', () => {
  const r = G.layoutOverlapping([item(600,690,'a'), item(690,780,'b')]);
  for (const x of r) eq(x.columnCount, 1, `${x.id} debe ocupar todo`);
});
check('dos solapados se reparten', () => {
  const r = G.layoutOverlapping([item(600,720,'a'), item(660,780,'b')]);
  eq(r.length, 2, 'ambos');
  for (const x of r) eq(x.columnCount, 2, 'mitad cada uno');
  eq(new Set(r.map(x=>x.column)).size, 2, 'columnas distintas');
});
check('tres solapados: tres columnas', () => {
  const r = G.layoutOverlapping([item(600,780,'a'), item(620,800,'b'), item(640,820,'c')]);
  for (const x of r) eq(x.columnCount, 3, 'tercios');
});
check('clusters independientes no se afectan', () => {
  const r = G.layoutOverlapping([
    item(600,720,'a'), item(660,780,'b'),   // cluster 1: solapan
    item(900,960,'c'),                       // cluster 2: solo
  ]);
  const c = r.find(x=>x.id==='c');
  eq(c.columnCount, 1, 'el aislado va a ancho completo');
  const a = r.find(x=>x.id==='a');
  eq(a.columnCount, 2, 'el cluster mantiene 2');
});
check('reutiliza columna cuando el tiempo se libera', () => {
  // a: 10-12, b: 11-13, c: 12:30-14  -> c puede ir en la columna de a
  const r = G.layoutOverlapping([item(600,720,'a'), item(660,780,'b'), item(750,840,'c')]);
  const a = r.find(x=>x.id==='a'), c = r.find(x=>x.id==='c');
  eq(a.column, c.column, 'c reutiliza la columna de a');
});
check('turnos consecutivos no cuentan como solapados', () => {
  const r = G.layoutOverlapping([item(600,690,'a'), item(690,780,'b')]);
  for (const x of r) eq(x.columnCount, 1, 'consecutivos son independientes');
});
check('lista vacía no rompe', () => eq(G.layoutOverlapping([]).length, 0, 'vacío'));

console.log('\nMarcas horarias\n');
check('rotula solo las horas en punto', () => {
  const t = G.timeTicks({openMinute:480, closeMinute:600});
  const labeled = t.filter(x=>x.label);
  eq(labeled.length, 3, '08:00, 09:00, 10:00');
  eq(labeled[0].label, '08:00', 'primera');
});
check('las medias horas van sin rótulo', () => {
  const t = G.timeTicks({openMinute:480, closeMinute:600});
  const half = t.find(x=>x.minute===510);
  eq(half.label, null, 'sin número');
  eq(half.major, false, 'menor');
});

console.log('\nFormato\n');
check('hora del día', () => {
  eq(G.formatMinute(0), '00:00', 'medianoche');
  eq(G.formatMinute(1080), '18:00', 'tarde');
  eq(G.formatMinute(1439), '23:59', 'fin del día');
  eq(G.formatMinute(1470), '00:30', 'madrugada del día siguiente');
});
check('duración legible', () => {
  eq(G.formatDuration(90), '1h 30min', 'mixta');
  eq(G.formatDuration(60), '1h', 'exacta');
  eq(G.formatDuration(45), '45min', 'menor a una hora');
});
check('fecha en prosa', () => {
  eq(G.formatLocalDate('2026-07-22'), 'miércoles 22 de julio', 'sin año');
  eq(G.formatLocalDate('2026-07-22',{withYear:true}), 'miércoles 22 de julio de 2026', 'con año');
});
check('navegación de fechas cruza meses', () => {
  eq(G.addDays('2026-07-31', 1), '2026-08-01', 'fin de mes');
  eq(G.addDays('2026-01-01', -1), '2025-12-31', 'año anterior');
});

console.log(`\n${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail?1:0);
