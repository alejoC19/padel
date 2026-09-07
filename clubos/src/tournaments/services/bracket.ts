/**
 * Generación de fixture.
 *
 * ---------------------------------------------------------------------------
 * FUNCIONES PURAS, SIN BASE DE DATOS
 * ---------------------------------------------------------------------------
 * Todo este archivo es aritmética de emparejamientos. Separarlo de la
 * persistencia permite probar cada formato con 4, 5, 7 u 11 equipos sin
 * montar un torneo real — que es donde aparecen los casos raros: byes,
 * rondas impares, grupos desparejos.
 * ---------------------------------------------------------------------------
 */

export type Format =
  | 'ELIMINATION'
  | 'DOUBLE_ELIMINATION'
  | 'ROUND_ROBIN'
  | 'GROUPS_PLAYOFF'
  | 'AMERICANO';

export interface SeedTeam {
  id: string;
  name: string;
  seed?: number;
}

export interface GeneratedMatch {
  round: string;
  roundNumber: number;
  matchNumber: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  groupName?: string;
  /** Si el equipo pasa sin jugar (número impar de participantes). */
  isBye: boolean;
}

// ---------------------------------------------------------------------------
// Eliminación directa
// ---------------------------------------------------------------------------

/**
 * Nombre de la ronda según cuántos equipos quedan.
 *
 * Se nombra por lo que queda, no por el número de ronda: "Octavos" se
 * entiende, "Ronda 2" obliga a contar.
 */
export function roundName(teamsInRound: number): string {
  switch (teamsInRound) {
    case 2: return 'Final';
    case 4: return 'Semifinal';
    case 8: return 'Cuartos';
    case 16: return 'Octavos';
    case 32: return 'Dieciseisavos';
    default: return `Ronda de ${teamsInRound}`;
  }
}

/**
 * Orden de siembra estándar.
 *
 * Coloca a los cabezas de serie en lados opuestos del cuadro para que no se
 * crucen antes de la final. Con 8 equipos da [1,8,4,5,2,7,3,6]: el 1 y el 2
 * solo pueden encontrarse en la final.
 *
 * Sin esto, el sorteo puede eliminar a los dos mejores en primera ronda y el
 * torneo pierde gracia.
 */
export function seedOrder(size: number): number[] {
  if (size < 2) return [1];
  let order = [1, 2];
  while (order.length < size) {
    const next: number[] = [];
    const total = order.length * 2 + 1;
    for (const s of order) {
      next.push(s, total - s);
    }
    order = next;
  }
  return order;
}

/**
 * Cuadro de eliminación directa.
 *
 * Si los equipos no son potencia de 2, los mejores sembrados reciben bye:
 * pasan de ronda sin jugar. Es lo correcto deportivamente — castigar al
 * primero con un partido extra sería al revés.
 */
export function generateElimination(teams: SeedTeam[]): GeneratedMatch[] {
  if (teams.length < 2) return [];

  const ordered = sortBySeed(teams);
  // Potencia de 2 inmediatamente superior.
  const bracketSize = 2 ** Math.ceil(Math.log2(ordered.length));
  const byes = bracketSize - ordered.length;

  // Se ubica cada equipo en su posición de siembra; las vacantes son byes.
  const positions = seedOrder(bracketSize);
  const slots: Array<SeedTeam | null> = positions.map((seed) =>
    seed <= ordered.length ? ordered[seed - 1]! : null,
  );

  const matches: GeneratedMatch[] = [];
  let roundNumber = 1;
  let current = slots;

  while (current.length > 1) {
    const name = roundName(current.length);
    const next: Array<SeedTeam | null> = [];
    let matchNumber = 1;

    for (let i = 0; i < current.length; i += 2) {
      const home = current[i] ?? null;
      const away = current[i + 1] ?? null;

      // Un bye es un equipo que pasa sin jugar. Solo puede pasar en la
      // primera ronda: después, un lado vacío significa "todavía no se sabe
      // quién viene", que es algo distinto.
      const isBye = roundNumber === 1 && (home === null) !== (away === null);

      matches.push({
        round: name,
        roundNumber,
        matchNumber: matchNumber++,
        homeTeamId: home?.id ?? null,
        awayTeamId: away?.id ?? null,
        isBye,
      });

      // El que pasa se conoce solo si hubo bye; si no, queda a definir.
      next.push(isBye ? (home ?? away) : null);
    }

    current = next;
    roundNumber++;
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Todos contra todos
// ---------------------------------------------------------------------------

/**
 * Round robin por el método del círculo.
 *
 * Con número impar se agrega un equipo fantasma: el que le toca descansa esa
 * fecha. Es la forma estándar y garantiza que todos jueguen la misma
 * cantidad de partidos.
 */
export function generateRoundRobin(teams: SeedTeam[]): GeneratedMatch[] {
  if (teams.length < 2) return [];

  const list: Array<SeedTeam | null> = [...teams];
  if (list.length % 2 !== 0) list.push(null); // fantasma = descansa

  const n = list.length;
  const rounds = n - 1;
  const half = n / 2;
  const matches: GeneratedMatch[] = [];

  // El primer equipo queda fijo y el resto rota alrededor.
  let rotation = list.slice(1);

  for (let r = 0; r < rounds; r++) {
    const roundTeams = [list[0]!, ...rotation];
    let matchNumber = 1;

    for (let i = 0; i < half; i++) {
      const home = roundTeams[i] ?? null;
      const away = roundTeams[n - 1 - i] ?? null;
      // Si uno es el fantasma, ese equipo descansa: no se genera partido.
      if (home === null || away === null) continue;

      matches.push({
        round: `Fecha ${r + 1}`,
        roundNumber: r + 1,
        matchNumber: matchNumber++,
        homeTeamId: home.id,
        awayTeamId: away.id,
        isBye: false,
      });
    }

    // Rotar: el último pasa al principio.
    rotation = [rotation[rotation.length - 1]!, ...rotation.slice(0, -1)];
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Grupos + playoff
// ---------------------------------------------------------------------------

/**
 * Reparte equipos en grupos y genera round robin dentro de cada uno.
 *
 * La distribución es serpenteada (1→A, 2→B, 3→C, 4→C, 5→B, 6→A) para que
 * los grupos queden parejos en nivel. Repartir en orden dejaría todos los
 * cabezas de serie en el grupo A.
 */
export function generateGroups(
  teams: SeedTeam[],
  groupCount: number,
): GeneratedMatch[] {
  if (teams.length < 2 || groupCount < 1) return [];

  const ordered = sortBySeed(teams);
  const groups: SeedTeam[][] = Array.from({ length: groupCount }, () => []);

  ordered.forEach((team, i) => {
    const round = Math.floor(i / groupCount);
    const pos = i % groupCount;
    // Serpenteo: las vueltas impares se llenan al revés.
    const groupIndex = round % 2 === 0 ? pos : groupCount - 1 - pos;
    groups[groupIndex]!.push(team);
  });

  const matches: GeneratedMatch[] = [];

  groups.forEach((group, gi) => {
    if (group.length < 2) return;
    const groupName = String.fromCharCode(65 + gi); // A, B, C...
    const inner = generateRoundRobin(group);

    for (const m of inner) {
      matches.push({
        ...m,
        round: `Grupo ${groupName} · ${m.round}`,
        groupName,
      });
    }
  });

  return matches;
}

// ---------------------------------------------------------------------------
// Americano
// ---------------------------------------------------------------------------

/**
 * Americano: las parejas rotan en cada ronda.
 *
 * Es el formato social del pádel — se juega por puntos individuales y cada
 * jugador cambia de compañero. Acá se modela con equipos ya armados que
 * rotan de rival, que es la variante que se usa en torneos organizados.
 *
 * Se limita a `roundsWanted` porque un americano completo con muchos equipos
 * lleva horas; el club decide cuántas rondas entran en la tarde.
 */
export function generateAmericano(
  teams: SeedTeam[],
  roundsWanted: number,
): GeneratedMatch[] {
  if (teams.length < 2) return [];

  const all = generateRoundRobin(teams);
  const maxRound = Math.max(...all.map((m) => m.roundNumber));
  const rounds = Math.min(roundsWanted, maxRound);

  return all
    .filter((m) => m.roundNumber <= rounds)
    .map((m) => ({ ...m, round: `Ronda ${m.roundNumber}` }));
}

// ---------------------------------------------------------------------------
// Tabla de posiciones
// ---------------------------------------------------------------------------

export interface StandingRow {
  teamId: string;
  name: string;
  played: number;
  won: number;
  lost: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
  points: number;
  position: number;
}

export interface MatchResult {
  homeTeamId: string | null;
  awayTeamId: string | null;
  /** [[6,4],[3,6],[7,5]] — cada par es un set. */
  scoreSets: Array<[number, number]> | null;
  status: string;
  winnerTeamId: string | null;
}

/**
 * Calcula la tabla.
 *
 * ---------------------------------------------------------------------------
 * CRITERIOS DE DESEMPATE
 * ---------------------------------------------------------------------------
 * En orden: puntos, diferencia de sets, diferencia de games, partidos
 * ganados. Es el estándar del pádel federado.
 *
 * La diferencia de games importa más de lo que parece: dos parejas pueden
 * terminar con los mismos puntos y la misma diferencia de sets, y ahí el
 * criterio es cuántos games sacó cada una.
 * ---------------------------------------------------------------------------
 */
export function calculateStandings(
  teams: Array<{ id: string; name: string }>,
  matches: MatchResult[],
  pointsPerWin = 3,
  pointsPerLoss = 0,
): StandingRow[] {
  const table = new Map<string, StandingRow>(
    teams.map((t) => [
      t.id,
      {
        teamId: t.id, name: t.name,
        played: 0, won: 0, lost: 0,
        setsWon: 0, setsLost: 0,
        gamesWon: 0, gamesLost: 0,
        points: 0, position: 0,
      },
    ]),
  );

  for (const m of matches) {
    if (m.status !== 'FINISHED' && m.status !== 'WALKOVER') continue;
    if (!m.homeTeamId || !m.awayTeamId) continue;

    const home = table.get(m.homeTeamId);
    const away = table.get(m.awayTeamId);
    if (!home || !away) continue;

    home.played++;
    away.played++;

    // Un walkover cuenta como partido ganado sin games.
    if (m.scoreSets) {
      let homeSets = 0;
      let awaySets = 0;

      for (const set of m.scoreSets) {
        const [h, a] = set;
        home.gamesWon += h;
        home.gamesLost += a;
        away.gamesWon += a;
        away.gamesLost += h;
        if (h > a) homeSets++;
        else if (a > h) awaySets++;
      }

      home.setsWon += homeSets;
      home.setsLost += awaySets;
      away.setsWon += awaySets;
      away.setsLost += homeSets;
    }

    const winner = m.winnerTeamId
      ?? (m.scoreSets ? inferWinner(m) : null);

    if (winner === m.homeTeamId) {
      home.won++; away.lost++;
      home.points += pointsPerWin;
      away.points += pointsPerLoss;
    } else if (winner === m.awayTeamId) {
      away.won++; home.lost++;
      away.points += pointsPerWin;
      home.points += pointsPerLoss;
    }
  }

  const rows = [...table.values()].sort((a, b) =>
    b.points - a.points ||
    (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost) ||
    (b.gamesWon - b.gamesLost) - (a.gamesWon - a.gamesLost) ||
    b.won - a.won ||
    a.name.localeCompare(b.name),
  );

  rows.forEach((r, i) => { r.position = i + 1; });
  return rows;
}

/** Gana quien se llevó más sets. */
function inferWinner(m: MatchResult): string | null {
  if (!m.scoreSets || !m.homeTeamId || !m.awayTeamId) return null;
  let h = 0, a = 0;
  for (const [hg, ag] of m.scoreSets) {
    if (hg > ag) h++;
    else if (ag > hg) a++;
  }
  if (h === a) return null;
  return h > a ? m.homeTeamId : m.awayTeamId;
}

/**
 * Valida un resultado de pádel.
 *
 * No alcanza con que sean números: 6-2 es válido, 6-5 no (hay que ganar por
 * dos o llegar a 7), y 9-3 tampoco. Cargar un resultado imposible ensucia
 * la tabla y nadie lo nota hasta que las posiciones no cierran.
 */
export function validateScore(
  sets: Array<[number, number]>,
): { valid: boolean; reason?: string } {
  if (sets.length === 0) {
    return { valid: false, reason: 'Cargá al menos un set.' };
  }
  if (sets.length > 5) {
    return { valid: false, reason: 'Un partido no puede tener más de 5 sets.' };
  }

  for (const [i, set] of sets.entries()) {
    const [h, a] = set;
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) {
      return { valid: false, reason: `Set ${i + 1}: los games deben ser números enteros.` };
    }
    if (h === a) {
      return { valid: false, reason: `Set ${i + 1}: un set no puede empatar.` };
    }

    const hi = Math.max(h, a);
    const lo = Math.min(h, a);

    // 7-6 (tie-break) o 7-5 son los únicos resultados con 7.
    if (hi === 7) {
      if (lo !== 5 && lo !== 6) {
        return { valid: false, reason: `Set ${i + 1}: 7-${lo} no es un resultado posible.` };
      }
      continue;
    }
    if (hi === 6) {
      if (lo > 4) {
        return { valid: false, reason: `Set ${i + 1}: 6-${lo} no cierra el set.` };
      }
      continue;
    }
    return {
      valid: false,
      reason: `Set ${i + 1}: ${hi}-${lo} no es un resultado válido de pádel.`,
    };
  }

  // El partido tiene que estar definido: nadie gana 1-1 en sets.
  let h = 0, a = 0;
  for (const [hg, ag] of sets) {
    if (hg > ag) h++; else a++;
  }
  if (h === a) {
    return { valid: false, reason: 'El partido queda empatado en sets.' };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------

function sortBySeed(teams: SeedTeam[]): SeedTeam[] {
  return [...teams].sort((a, b) => {
    // Los sembrados van primero, en orden; el resto queda como vino.
    if (a.seed != null && b.seed != null) return a.seed - b.seed;
    if (a.seed != null) return -1;
    if (b.seed != null) return 1;
    return 0;
  });
}

/** Cuántos partidos genera cada formato. Sirve para avisar antes de crear. */
export function estimateMatches(
  format: Format,
  teamCount: number,
  groupCount = 4,
): number {
  if (teamCount < 2) return 0;
  switch (format) {
    case 'ELIMINATION':
      return teamCount - 1;
    case 'DOUBLE_ELIMINATION':
      return (teamCount - 1) * 2;
    case 'ROUND_ROBIN':
    case 'AMERICANO':
      return (teamCount * (teamCount - 1)) / 2;
    case 'GROUPS_PLAYOFF': {
      const perGroup = Math.ceil(teamCount / groupCount);
      const groupMatches = groupCount * ((perGroup * (perGroup - 1)) / 2);
      // Playoff con los dos primeros de cada grupo.
      return Math.round(groupMatches + groupCount * 2 - 1);
    }
    default:
      return 0;
  }
}
