/** Verificación de generación de fixture y tablas. */
require('child_process').execSync(
  'npx tsc src/tournaments/services/bracket.ts --outDir /tmp/brk --target ES2022 --module commonjs --skipLibCheck',
  { stdio: 'inherit' });
const B = require('/tmp/brk/bracket.js');

let pass=0, fail=0;
const check=(n,f)=>{try{f();console.log(`  ✓ ${n}`);pass++;}catch(e){console.log(`  ✗ ${n}\n      ${e.message}`);fail++;}};
const eq=(a,b,m)=>{if(a!==b)throw new Error(`${m}: got ${a}, want ${b}`)};

const teams = n => Array.from({length:n},(_,i)=>({id:`t${i+1}`,name:`Equipo ${i+1}`,seed:i+1}));

console.log('\nSiembra\n');

check('con 8 equipos el 1 y el 2 solo se cruzan en la final', () => {
  const order = B.seedOrder(8);
  eq(order.join(','), '1,8,4,5,2,7,3,6', 'orden estándar');
  // El 1 está en la mitad de arriba, el 2 en la de abajo.
  const mitad = order.slice(0,4);
  if (!mitad.includes(1)) throw new Error('el 1 debe ir arriba');
  if (mitad.includes(2)) throw new Error('el 2 debe ir abajo');
});

check('con 16 equipos también', () => {
  const order = B.seedOrder(16);
  eq(order.length, 16, 'tamaño');
  eq(order[0], 1, 'el 1 primero');
  const mitad = order.slice(0,8);
  if (mitad.includes(2)) throw new Error('el 2 va en la otra mitad');
});

console.log('\nEliminación directa\n');

check('8 equipos: 7 partidos', () => {
  const m = B.generateElimination(teams(8));
  eq(m.length, 7, '4 + 2 + 1');
});

check('las rondas se nombran por lo que queda', () => {
  const m = B.generateElimination(teams(8));
  const names = [...new Set(m.map(x=>x.round))];
  eq(names.join(' → '), 'Cuartos → Semifinal → Final', 'nombres');
});

check('la primera ronda tiene a todos los equipos', () => {
  const m = B.generateElimination(teams(8)).filter(x=>x.roundNumber===1);
  const ids = new Set(m.flatMap(x=>[x.homeTeamId,x.awayTeamId]).filter(Boolean));
  eq(ids.size, 8, 'los 8 juegan');
});

check('el 1 enfrenta al 8 en cuartos', () => {
  const m = B.generateElimination(teams(8));
  const primero = m.find(x=>x.roundNumber===1 && x.homeTeamId==='t1');
  eq(primero.awayTeamId, 't8', 'el mejor contra el peor');
});

check('con 5 equipos hay byes para los mejores', () => {
  const m = B.generateElimination(teams(5));
  const byes = m.filter(x=>x.isBye);
  eq(byes.length, 3, '8 - 5 = 3 byes');
  // El primer sembrado no juega la primera ronda.
  const r1 = m.filter(x=>x.roundNumber===1);
  const t1Match = r1.find(x=>x.homeTeamId==='t1'||x.awayTeamId==='t1');
  eq(t1Match.isBye, true, 'el 1 pasa directo');
});

check('con 3 equipos funciona', () => {
  const m = B.generateElimination(teams(3));
  eq(m.filter(x=>x.roundNumber===1).length, 2, 'dos llaves');
  eq(m.filter(x=>x.isBye).length, 1, 'un bye');
});

check('con 2 equipos es solo la final', () => {
  const m = B.generateElimination(teams(2));
  eq(m.length, 1, 'un partido');
  eq(m[0].round, 'Final', 'es la final');
});

check('con menos de 2 no genera nada', () => {
  eq(B.generateElimination(teams(1)).length, 0, 'sin partidos');
  eq(B.generateElimination([]).length, 0, 'vacío');
});

check('16 equipos genera 15 partidos en 4 rondas', () => {
  const m = B.generateElimination(teams(16));
  eq(m.length, 15, '8+4+2+1');
  eq(Math.max(...m.map(x=>x.roundNumber)), 4, 'cuatro rondas');
});

console.log('\nTodos contra todos\n');

check('4 equipos: 6 partidos en 3 fechas', () => {
  const m = B.generateRoundRobin(teams(4));
  eq(m.length, 6, 'n(n-1)/2');
  eq(Math.max(...m.map(x=>x.roundNumber)), 3, 'tres fechas');
});

check('todos juegan contra todos exactamente una vez', () => {
  const m = B.generateRoundRobin(teams(5));
  const pares = new Set();
  for (const x of m) {
    const par = [x.homeTeamId, x.awayTeamId].sort().join('-');
    if (pares.has(par)) throw new Error(`repetido: ${par}`);
    pares.add(par);
  }
  eq(pares.size, 10, '5 equipos = 10 cruces');
});

check('con impares cada equipo descansa una fecha', () => {
  const m = B.generateRoundRobin(teams(5));
  eq(m.length, 10, 'partidos');
  // 5 fechas, 2 partidos por fecha (uno descansa)
  eq(Math.max(...m.map(x=>x.roundNumber)), 5, 'cinco fechas');
  for (let r=1; r<=5; r++) {
    eq(m.filter(x=>x.roundNumber===r).length, 2, `fecha ${r}`);
  }
});

check('todos juegan la misma cantidad de partidos', () => {
  const m = B.generateRoundRobin(teams(6));
  const count = {};
  for (const x of m) {
    count[x.homeTeamId] = (count[x.homeTeamId]??0)+1;
    count[x.awayTeamId] = (count[x.awayTeamId]??0)+1;
  }
  const valores = [...new Set(Object.values(count))];
  eq(valores.length, 1, 'todos juegan lo mismo');
  eq(valores[0], 5, 'cada uno juega 5');
});

console.log('\nGrupos\n');

check('8 equipos en 2 grupos', () => {
  const m = B.generateGroups(teams(8), 2);
  const grupos = [...new Set(m.map(x=>x.groupName))];
  eq(grupos.sort().join(','), 'A,B', 'dos grupos');
  // 4 equipos por grupo = 6 partidos cada uno
  eq(m.length, 12, '6 + 6');
});

check('el reparto es serpenteado, no en orden', () => {
  const m = B.generateGroups(teams(8), 2);
  const grupoA = new Set(m.filter(x=>x.groupName==='A')
    .flatMap(x=>[x.homeTeamId,x.awayTeamId]));
  // Serpenteo: 1→A, 2→B, 3→B, 4→A ... el 1 y el 2 quedan separados.
  if (grupoA.has('t1') && grupoA.has('t2')) {
    throw new Error('los dos primeros no deben caer en el mismo grupo');
  }
});

check('con equipos desparejos los grupos quedan lo más parejos posible', () => {
  const m = B.generateGroups(teams(7), 2);
  const porGrupo = {};
  for (const x of m) {
    const equipos = porGrupo[x.groupName] ??= new Set();
    equipos.add(x.homeTeamId); equipos.add(x.awayTeamId);
  }
  const tamaños = Object.values(porGrupo).map(s=>s.size).sort();
  eq(Math.abs(tamaños[0]-tamaños[1]) <= 1, true, 'diferencia máxima de 1');
});

console.log('\nAmericano\n');

check('respeta el límite de rondas', () => {
  const m = B.generateAmericano(teams(6), 3);
  eq(Math.max(...m.map(x=>x.roundNumber)), 3, 'tres rondas');
  eq(m.length, 9, '3 partidos × 3 rondas');
});

check('no genera más rondas de las posibles', () => {
  const m = B.generateAmericano(teams(4), 10);
  eq(Math.max(...m.map(x=>x.roundNumber)), 3, 'máximo con 4 equipos');
});

console.log('\nValidación de resultados\n');

check('6-4 es válido', () => eq(B.validateScore([[6,4]]).valid, true, 'set normal'));
check('7-5 es válido', () => eq(B.validateScore([[7,5]]).valid, true, 'set ajustado'));
check('7-6 es válido (tie-break)', () => eq(B.validateScore([[7,6]]).valid, true, 'tie-break'));
check('6-0 es válido', () => eq(B.validateScore([[6,0]]).valid, true, 'rosco'));

check('6-5 NO es válido', () => {
  const r = B.validateScore([[6,5]]);
  eq(r.valid, false, 'hay que ganar por dos o llegar a 7');
});
check('9-3 NO es válido', () => {
  eq(B.validateScore([[9,3]]).valid, false, 'no existe en pádel');
});
check('7-3 NO es válido', () => {
  eq(B.validateScore([[7,3]]).valid, false, 'solo 7-5 o 7-6');
});
check('un set empatado NO es válido', () => {
  eq(B.validateScore([[6,6]]).valid, false, 'no se puede empatar');
});
check('un partido empatado en sets NO es válido', () => {
  eq(B.validateScore([[6,4],[3,6]]).valid, false, '1-1 no define');
});
check('dos sets a cero es válido', () => {
  eq(B.validateScore([[6,4],[6,2]]).valid, true, 'partido cerrado');
});
check('tres sets es válido', () => {
  eq(B.validateScore([[6,4],[3,6],[7,5]]).valid, true, 'con tercer set');
});
check('sin sets no es válido', () => {
  eq(B.validateScore([]).valid, false, 'hace falta al menos uno');
});

console.log('\nTabla de posiciones\n');

const T = [
  {id:'a',name:'Alfa'}, {id:'b',name:'Beta'},
  {id:'c',name:'Gamma'}, {id:'d',name:'Delta'},
];
const match = (h,a,sets,winner) => ({
  homeTeamId:h, awayTeamId:a, scoreSets:sets,
  status:'FINISHED', winnerTeamId:winner,
});

check('el ganador suma 3 puntos', () => {
  const t = B.calculateStandings(T, [match('a','b',[[6,4],[6,3]],'a')]);
  const alfa = t.find(x=>x.teamId==='a');
  eq(alfa.points, 3, 'puntos');
  eq(alfa.won, 1, 'ganados');
  const beta = t.find(x=>x.teamId==='b');
  eq(beta.points, 0, 'el perdedor no suma');
  eq(beta.lost, 1, 'perdidos');
});

check('los sets y games se acumulan correctamente', () => {
  const t = B.calculateStandings(T, [match('a','b',[[6,4],[3,6],[6,2]],'a')]);
  const alfa = t.find(x=>x.teamId==='a');
  eq(alfa.setsWon, 2, 'sets ganados');
  eq(alfa.setsLost, 1, 'sets perdidos');
  eq(alfa.gamesWon, 15, '6+3+6');
  eq(alfa.gamesLost, 12, '4+6+2');
});

check('desempata por diferencia de sets', () => {
  const t = B.calculateStandings(T, [
    match('a','c',[[6,0],[6,0]],'a'),   // Alfa: +2 sets
    match('b','d',[[6,4],[4,6],[6,4]],'b'), // Beta: +1 set
  ]);
  eq(t[0].teamId, 'a', 'gana el de mejor diferencia de sets');
  eq(t[0].points, t[1].points, 'ambos con 3 puntos');
});

check('desempata por diferencia de games', () => {
  const t = B.calculateStandings(T, [
    match('a','c',[[6,0],[6,1]],'a'),   // +11 games
    match('b','d',[[6,4],[6,4]],'b'),   // +4 games
  ]);
  eq(t[0].teamId, 'a', 'gana el de más games');
});

check('el ganador se infiere del resultado si no viene', () => {
  const t = B.calculateStandings(T, [
    { homeTeamId:'a', awayTeamId:'b', scoreSets:[[6,4],[6,3]],
      status:'FINISHED', winnerTeamId:null },
  ]);
  eq(t.find(x=>x.teamId==='a').won, 1, 'gana quien sacó más sets');
});

check('los partidos no jugados no cuentan', () => {
  const t = B.calculateStandings(T, [
    { homeTeamId:'a', awayTeamId:'b', scoreSets:null,
      status:'SCHEDULED', winnerTeamId:null },
  ]);
  eq(t.every(x=>x.played===0), true, 'nadie jugó todavía');
});

check('un walkover cuenta como partido ganado', () => {
  const t = B.calculateStandings(T, [
    { homeTeamId:'a', awayTeamId:'b', scoreSets:null,
      status:'WALKOVER', winnerTeamId:'a' },
  ]);
  eq(t.find(x=>x.teamId==='a').won, 1, 'suma la victoria');
  eq(t.find(x=>x.teamId==='a').gamesWon, 0, 'sin games');
});

check('las posiciones se numeran desde 1', () => {
  const t = B.calculateStandings(T, [match('a','b',[[6,4],[6,3]],'a')]);
  eq(t[0].position, 1, 'primero');
  eq(t[t.length-1].position, T.length, 'último');
});

console.log('\nEstimación de partidos\n');

check('eliminación: n-1', () => eq(B.estimateMatches('ELIMINATION',16), 15, '16 equipos'));
check('round robin: n(n-1)/2', () => eq(B.estimateMatches('ROUND_ROBIN',8), 28, '8 equipos'));
check('doble eliminación: casi el doble', () => eq(B.estimateMatches('DOUBLE_ELIMINATION',8), 14, '8 equipos'));

console.log(`\n${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail?1:0);
