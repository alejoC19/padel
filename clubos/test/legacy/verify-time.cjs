/** Verificación de conversiones de zona horaria. */
const ts = require('fs').readFileSync('src/bookings/time.util.ts','utf8');
// transpilar quitando tipos: usar tsc real
require('child_process').execSync('npx tsc src/bookings/time.util.ts --outDir /tmp/tjs --target ES2022 --module commonjs --skipLibCheck', {stdio:'inherit'});
const T = require('/tmp/tjs/time.util.js');

let pass=0, fail=0;
const check=(n,f)=>{try{f();console.log(`  ✓ ${n}`);pass++;}catch(e){console.log(`  ✗ ${n}\n      ${e.message}`);fail++;}};
const eq=(a,b,m)=>{if(a!==b)throw new Error(`${m}: got ${a}, want ${b}`);};

const AR='America/Argentina/Buenos_Aires';
const ES='Europe/Madrid';
const CL='America/Santiago';

console.log('\nArgentina (UTC-3, sin DST)\n');

check('20:00 local -> 23:00 UTC', ()=>{
  const d=T.localToUtc('2026-07-22', 20*60, AR);
  eq(d.toISOString(),'2026-07-22T23:00:00.000Z','conversión');
});

check('ida y vuelta preserva el minuto', ()=>{
  for(const min of [0,90,480,1230,1439]){
    const d=T.localToUtc('2026-03-15',min,AR);
    eq(T.utcToMinuteOfDay(d,AR),min,`minuto ${min}`);
    eq(T.utcToLocalDate(d,AR),'2026-03-15',`fecha para minuto ${min}`);
  }
});

check('23:30 local no salta de día', ()=>{
  const d=T.localToUtc('2026-07-22',23*60+30,AR);
  eq(T.utcToLocalDate(d,AR),'2026-07-22','fecha local');
  eq(d.toISOString(),'2026-07-23T02:30:00.000Z','UTC cruza medianoche, correcto');
});

check('día de semana correcto', ()=>{
  // 2026-07-22 es miércoles
  eq(T.localDayOfWeek(T.localToUtc('2026-07-22',600,AR),AR),3,'miércoles=3');
  // 2026-07-26 domingo
  eq(T.localDayOfWeek(T.localToUtc('2026-07-26',600,AR),AR),0,'domingo=0');
  // 2026-07-25 sábado
  eq(T.localDayOfWeek(T.localToUtc('2026-07-25',600,AR),AR),6,'sábado=6');
});

check('rango del día cubre 24hs exactas', ()=>{
  const {start,end}=T.localDayRange('2026-07-22',AR);
  eq(end.getTime()-start.getTime(),24*3600*1000,'duración');
  eq(start.toISOString(),'2026-07-22T03:00:00.000Z','inicio');
  eq(end.toISOString(),'2026-07-23T03:00:00.000Z','fin');
});

check('medianoche local pertenece al día correcto', ()=>{
  const d=T.localToUtc('2026-07-22',0,AR);
  eq(T.utcToLocalDate(d,AR),'2026-07-22','día');
  eq(T.utcToMinuteOfDay(d,AR),0,'minuto');
});

console.log('\nZonas CON horario de verano\n');

check('España invierno (UTC+1)', ()=>{
  const d=T.localToUtc('2026-01-15',20*60,ES);
  eq(d.toISOString(),'2026-01-15T19:00:00.000Z','CET');
});

check('España verano (UTC+2)', ()=>{
  const d=T.localToUtc('2026-07-15',20*60,ES);
  eq(d.toISOString(),'2026-07-15T18:00:00.000Z','CEST');
});

check('ida y vuelta sobrevive al cambio de DST', ()=>{
  // España adelanta el 29/03/2026 a las 02:00 -> 03:00
  for(const date of ['2026-03-28','2026-03-29','2026-03-30']){
    for(const min of [60, 240, 600, 1200]){
      const d=T.localToUtc(date,min,ES);
      const back=T.utcToMinuteOfDay(d,ES);
      const backDate=T.utcToLocalDate(d,ES);
      if(backDate!==date) throw new Error(`${date} ${min}min -> fecha ${backDate}`);
      // La hora 02:00-02:59 del 29/3 NO EXISTE en España.
      if(!(date==='2026-03-29'&&min>=120&&min<180)){
        eq(back,min,`${date} minuto ${min}`);
      }
    }
  }
});

check('día de DST no rompe el rango', ()=>{
  const {start,end}=T.localDayRange('2026-03-29',ES);
  const hours=(end.getTime()-start.getTime())/3600000;
  eq(hours,23,'el 29/3 en España tiene 23 horas');
});

check('Chile (DST invertido)', ()=>{
  const inv=T.localToUtc('2026-07-15',20*60,CL);
  const ver=T.localToUtc('2026-01-15',20*60,CL);
  if(inv.getUTCHours()===ver.getUTCHours()) throw new Error('no detectó cambio DST');
});

console.log('\nParsing y validación\n');

check('parseMinute/formatMinute round-trip', ()=>{
  for(const s of ['00:00','08:30','12:00','20:45','23:59']){
    eq(T.formatMinute(T.parseMinute(s)),s,s);
  }
});

check('parseMinute rechaza inválidos', ()=>{
  for(const s of ['24:00','25:30','12:60','abc','8:5','']){
    let threw=false;
    try{T.parseMinute(s);}catch{threw=true;}
    if(!threw) throw new Error(`aceptó "${s}"`);
  }
});

check('formatMinute maneja 1440 (medianoche siguiente)', ()=>{
  eq(T.formatMinute(1440),'00:00','1440');
});

check('isValidLocalDate rechaza fechas irreales', ()=>{
  if(!T.isValidLocalDate('2026-02-28')) throw new Error('rechazó válida');
  if(T.isValidLocalDate('2026-02-30')) throw new Error('aceptó 30 de febrero');
  if(T.isValidLocalDate('2026-13-01')) throw new Error('aceptó mes 13');
  if(T.isValidLocalDate('2026-1-1')) throw new Error('aceptó formato corto');
  if(!T.isValidLocalDate('2028-02-29')) throw new Error('rechazó bisiesto válido');
  if(T.isValidLocalDate('2026-02-29')) throw new Error('aceptó bisiesto inválido');
});

check('addLocalDays cruza meses y años', ()=>{
  eq(T.addLocalDays('2026-07-22',1),'2026-07-23','+1');
  eq(T.addLocalDays('2026-07-31',1),'2026-08-01','fin de mes');
  eq(T.addLocalDays('2026-12-31',1),'2027-01-01','fin de año');
  eq(T.addLocalDays('2026-03-01',-1),'2026-02-28','negativo');
});

console.log(`\n${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail?1:0);
