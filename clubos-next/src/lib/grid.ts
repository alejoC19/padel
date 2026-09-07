/**
 * Geometría de la grilla temporal.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ POSICIONAMIENTO ABSOLUTO Y NO UNA TABLA
 * ---------------------------------------------------------------------------
 * La primera intuición es armar la agenda como una tabla: una fila por franja
 * de 30 minutos, una celda por cancha. Funciona hasta que aparece una reserva
 * de 90 minutos que arranca a las 20:15 — y ahí hay que hacer rowspan sobre
 * franjas que no existen, o inventar una grilla de 15 minutos que triplica
 * las filas.
 *
 * Con posicionamiento absoluto sobre una regla de tiempo, un bloque es
 * simplemente `top = minutos desde apertura × altura del minuto`. Cualquier
 * duración y cualquier hora de inicio funcionan sin casos especiales, y los
 * huecos libres se ven como espacio vacío real, que es cómo un recepcionista
 * piensa la agenda.
 * ---------------------------------------------------------------------------
 */

/** Píxeles por minuto. Debe coincidir con --minute-height en tokens.css. */
export const MINUTE_PX = 1.0;

/** Altura mínima de un bloque para que el texto adentro sea legible. */
const MIN_BLOCK_PX = 26;

export interface GridWindow {
  /** Minuto de apertura (desde medianoche local). */
  openMinute: number;
  /** Minuto de cierre. Puede pasar de 1440 si el club cierra de madrugada. */
  closeMinute: number;
}

export interface BlockGeometry {
  top: number;
  height: number;
  /** Bloques que se solapan se reparten el ancho de la columna. */
  leftPercent: number;
  widthPercent: number;
}

/** Posición vertical de un instante dentro de la ventana visible. */
export function minuteToY(minute: number, win: GridWindow): number {
  return (minute - win.openMinute) * MINUTE_PX;
}

/** Minuto correspondiente a una coordenada Y. Inverso de minuteToY. */
export function yToMinute(y: number, win: GridWindow): number {
  return win.openMinute + y / MINUTE_PX;
}

/**
 * Redondea un minuto al múltiplo de `step` más cercano.
 * Al arrastrar un bloque, esto es lo que lo hace "imantar" a la grilla.
 */
export function snapMinute(minute: number, step: number): number {
  return Math.round(minute / step) * step;
}

export function gridHeight(win: GridWindow): number {
  return (win.closeMinute - win.openMinute) * MINUTE_PX;
}

/**
 * Reparte el ancho entre bloques que se solapan.
 *
 * En teoría el EXCLUDE constraint del backend impide reservas solapadas en
 * la misma cancha, así que esto no debería activarse nunca. Se implementa
 * igual por dos razones: durante un arrastre se muestra la posición
 * tentativa junto a la original, y si algún día hay datos inconsistentes es
 * preferible verlos lado a lado que uno tapando al otro.
 */
export function layoutOverlapping<T extends { startMinute: number; endMinute: number }>(
  items: T[],
): Array<T & { column: number; columnCount: number }> {
  if (items.length === 0) return [];

  const sorted = [...items].sort(
    (a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute,
  );

  const result: Array<T & { column: number; columnCount: number }> = [];
  let cluster: Array<T & { column: number; columnCount: number }> = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const cols = cluster.length > 0
      ? Math.max(...cluster.map((c) => c.column)) + 1
      : 0;
    for (const c of cluster) c.columnCount = cols;
    result.push(...cluster);
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (item.startMinute >= clusterEnd) flush();

    // Primera columna libre en este punto del tiempo.
    const taken = new Set(
      cluster
        .filter((c) => c.endMinute > item.startMinute)
        .map((c) => c.column),
    );
    let column = 0;
    while (taken.has(column)) column++;

    cluster.push({ ...item, column, columnCount: 1 });
    clusterEnd = Math.max(clusterEnd, item.endMinute);
  }
  flush();

  return result;
}

/** Geometría final de un bloque, lista para aplicar como estilo. */
export function blockGeometry(
  startMinute: number,
  endMinute: number,
  win: GridWindow,
  column = 0,
  columnCount = 1,
): BlockGeometry {
  const top = minuteToY(startMinute, win);
  const rawHeight = (endMinute - startMinute) * MINUTE_PX;

  return {
    top,
    height: Math.max(rawHeight, MIN_BLOCK_PX),
    leftPercent: (column / columnCount) * 100,
    widthPercent: (1 / columnCount) * 100,
  };
}

/**
 * Marcas horarias de la regla lateral.
 * Se rotula cada hora en punto; las medias van sin número.
 */
export function timeTicks(win: GridWindow): Array<{
  minute: number;
  y: number;
  label: string | null;
  major: boolean;
}> {
  const ticks: Array<{ minute: number; y: number; label: string | null; major: boolean }> = [];
  const start = Math.ceil(win.openMinute / 30) * 30;

  for (let m = start; m <= win.closeMinute; m += 30) {
    const isHour = m % 60 === 0;
    ticks.push({
      minute: m,
      y: minuteToY(m, win),
      label: isHour ? formatMinute(m) : null,
      major: isHour,
    });
  }
  return ticks;
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

/** 'HH:MM' desde minuto del día. Soporta minutos > 1440 (madrugada). */
export function formatMinute(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60) % 24;
  const m = Math.round(minuteOfDay % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

/** Pesos en formato argentino, sin decimales (nadie cobra centavos). */
export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amount);
}

const DAY_NAMES = [
  'domingo', 'lunes', 'martes', 'miércoles',
  'jueves', 'viernes', 'sábado',
];
const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * Parsea 'YYYY-MM-DD' a sus partes numéricas.
 *
 * Devolver una tupla tipada en vez de indexar el resultado de split() hace
 * explícito que la fecha puede venir mal formada — y obliga a decidir qué
 * pasa en ese caso en vez de romper con un undefined más adelante.
 */
function parseLocalDate(iso: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Fecha inválida: ${iso}. Formato esperado: YYYY-MM-DD`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/**
 * Fecha en prosa: "miércoles 22 de julio".
 *
 * Se construye a mano en vez de usar Intl porque hace falta el mismo
 * formato exacto en el encabezado y en los chips de navegación, y las
 * variantes de Intl entre navegadores introducen diferencias sutiles
 * (mayúscula inicial, coma antes del día) que se notan al lado.
 */
export function formatLocalDate(iso: string, opts: { withYear?: boolean } = {}): string {
  const { year, month, day } = parseLocalDate(iso);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayName = DAY_NAMES[date.getUTCDay()] ?? '';
  const monthName = MONTH_NAMES[month - 1] ?? '';
  const base = `${dayName} ${day} de ${monthName}`;
  return opts.withYear ? `${base} de ${year}` : base;
}

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, days: number): string {
  const { year, month, day } = parseLocalDate(iso);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function isToday(iso: string): boolean {
  return iso === todayISO();
}

/** Minuto actual del día. Alimenta la línea de "ahora". */
export function currentMinuteOfDay(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}
