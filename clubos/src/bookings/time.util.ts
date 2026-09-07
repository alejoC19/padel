/**
 * Utilidades de tiempo para la agenda.
 *
 * ---------------------------------------------------------------------------
 * EL PROBLEMA
 * ---------------------------------------------------------------------------
 * La BD guarda instantes UTC. El club razona en hora local ("cancha 2 a las
 * 20hs"). Convertir mal entre ambos produce bugs que solo aparecen en
 * ciertos horarios o ciertas fechas — los más caros de diagnosticar.
 *
 * Argentina no tiene horario de verano desde 2009, pero el sistema debe
 * soportar clubes en zonas que sí lo tienen (Chile, México, España). Por eso
 * NO se hace `new Date(y, m, d, h)` con la zona del servidor: se usa
 * Intl.DateTimeFormat, que conoce la base de datos IANA de zonas horarias.
 *
 * ---------------------------------------------------------------------------
 * CONVENCIÓN
 * ---------------------------------------------------------------------------
 *  - `Date` en el código = instante absoluto (UTC internamente).
 *  - "minuto del día" = minutos desde medianoche LOCAL del club (0..1439).
 *  - "fecha local" = 'YYYY-MM-DD' en la zona del club.
 * ---------------------------------------------------------------------------
 */

/** Partes de un instante expresadas en la zona indicada. */
interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsInZone(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }

  // Intl devuelve 24 para medianoche en algunos runtimes; normalizar.
  if (out.hour === 24) out.hour = 0;

  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second ?? 0,
  };
}

/** Desfase de la zona respecto de UTC, en minutos, en ese instante. */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - date.getTime()) / 60_000;
}

/**
 * Convierte fecha local + minuto del día a instante UTC.
 *
 * Itera dos veces porque el offset depende del instante que estamos
 * calculando (problema del huevo y la gallina en cambios de DST). La segunda
 * pasada corrige el caso en que la primera estimación cayó del otro lado
 * del salto horario.
 */
export function localToUtc(
  localDate: string,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const [y, m, d] = localDate.split('-').map(Number);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;

  // Primera estimación: tratar la hora local como si fuera UTC.
  let guess = new Date(Date.UTC(y, m - 1, d, hour, minute, 0, 0));
  for (let i = 0; i < 2; i++) {
    const off = offsetMinutes(guess, timeZone);
    const corrected = new Date(
      Date.UTC(y, m - 1, d, hour, minute, 0, 0) - off * 60_000,
    );
    if (corrected.getTime() === guess.getTime()) break;
    guess = corrected;
  }
  return guess;
}

/** Fecha local del club para un instante, como 'YYYY-MM-DD'. */
export function utcToLocalDate(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Minuto del día (hora local del club) para un instante. */
export function utcToMinuteOfDay(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  return p.hour * 60 + p.minute;
}

/**
 * Día de la semana en hora local: 0=domingo .. 6=sábado.
 * Coincide con la convención de `OperatingHour.dayOfWeek`.
 */
export function localDayOfWeek(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  // Date.UTC + getUTCDay evita que la zona del servidor influya.
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Rango [inicio, fin) que cubre un día local completo, en UTC. */
export function localDayRange(
  localDate: string,
  timeZone: string,
): { start: Date; end: Date } {
  return {
    start: localToUtc(localDate, 0, timeZone),
    // 1440 = medianoche del día siguiente. localToUtc lo normaliza.
    end: localToUtc(localDate, 1440, timeZone),
  };
}

/** 'HH:MM' desde minuto del día. */
export function formatMinute(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60) % 24;
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Minuto del día desde 'HH:MM'. Lanza si el formato es inválido. */
export function parseMinute(hhmm: string): number {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`Hora inválida: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Suma días a una fecha local 'YYYY-MM-DD' sin tocar zonas horarias. */
export function addLocalDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return utcToLocalDate(dt, 'UTC');
}

/** Valida 'YYYY-MM-DD' y que sea una fecha real (rechaza 2026-02-30). */
export function isValidLocalDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}
