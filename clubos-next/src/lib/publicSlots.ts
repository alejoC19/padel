/**
 * Grilla de horarios para el portal del jugador.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ COMPARAR INSTANTES ABSOLUTOS Y NO "MINUTO DEL DÍA"
 * ---------------------------------------------------------------------------
 * El panel de staff (agenda.service.ts, backend) convierte cada reserva a
 * "minuto del día en el huso horario del club" para dibujarla en la regla
 * vertical de la agenda. Esa conversión necesita el timezone del club — dato
 * que `GET /public/clubs/:slug` y `.../availability` NO exponen (es
 * intencionalmente mínimo para la vista pública).
 *
 * `GET .../availability` expone `timezone` (IANA del club) junto con
 * `openMinute`/`closeMinute`, así que cada horario candidato se construye
 * con `zonedMinuteToUtc` en el huso del CLUB, no en el del dispositivo que
 * mira la pantalla. Antes se armaba con `new Date(year, month, day, h, m)`
 * (hora local del navegador) asumiendo que el jugador reserva desde el
 * mismo huso que el club — rompía en cualquier dispositivo con el reloj en
 * otro huso: el horario se veía "disponible" en pantalla (la comparación
 * contra `busy` usaba el mismo instante corrido, así que no mostraba
 * contradicción) pero `reservar` lo rechazaba con 409 al llegar al backend,
 * que sí calcula en UTC real contra las reservas reales.
 * ---------------------------------------------------------------------------
 *
 * El rango de horarios SÍ viene del backend (`PublicCourt.openMinute` /
 * `closeMinute`, calculados por `agenda.service.ts` a partir de
 * `OperatingHour` real): generar acá un rango fijo (p. ej. 08:00-24:00)
 * mostraba turnos "disponibles" que el club en realidad tiene cerrados, y el
 * `reservar` los rechazaba con 409 al confirmar — una reserva que se ve
 * posible en la pantalla pero nunca se puede completar.
 */

export interface BusyInterval {
  courtId: string;
  startsAt: string;
  endsAt: string;
}

/** Duraciones que acepta `reservar` (ver public.service.ts). */
export const ALLOWED_DURATIONS = [60, 120] as const;
export type AllowedDuration = (typeof ALLOWED_DURATIONS)[number];

/** Paso de la grilla: en punto, nada de 19:00/19:30 — un turno dura 1h o 2h. */
const STEP_MINUTES = 60;

export interface SlotCandidate {
  /** Minuto del día (para ordenar/formatear), no para comparar solapamiento. */
  startMinute: number;
  /** Instante absoluto de inicio, listo para mandar a `reservar`. */
  startsAt: string;
  /** Instante absoluto de fin, para el chequeo de solapamiento. */
  endsAtMs: number;
  startsAtMs: number;
}

function parseDateISO(dateISO: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) throw new Error(`Fecha inválida: ${dateISO}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/**
 * Instante UTC correspondiente a "minuto `minute` del día `dateISO`, en el
 * huso `timezone`". `minute` puede pasar de 1440 (franja de madrugada que
 * sigue abierta del día siguiente, ver `GridWindow.closeMinute`).
 *
 * No hay forma directa de pedirle esto a `Date` (solo convierte UTC → huso,
 * nunca al revés) ni a `Intl` sin una librería de timezones. Se resuelve por
 * aproximación: arma un instante ADIVINANDO que esos Y-M-D-H-M ya son UTC,
 * mira en qué Y-M-D-H-M cae ESE instante dentro de `timezone`, y corrige la
 * adivinanza por la diferencia. Converge en una pasada para husos sin DST
 * (Argentina) y en como mucho dos para husos con DST — por eso el loop
 * corto en vez de asumir una sola iteración.
 */
function zonedMinuteToUtc(dateISO: string, minute: number, timezone: string): Date {
  const { year, month, day } = parseDateISO(dateISO);
  const dayOffset = Math.floor(minute / 1440);
  const minuteOfDay = minute - dayOffset * 1440;
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  const target = Date.UTC(year, month - 1, day + dayOffset, h, m, 0, 0);

  let guess = target;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
    }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const seenAsUtc = Date.UTC(
      get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'),
    );
    const diff = seenAsUtc - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

/**
 * Arma los horarios candidatos de un día para una duración dada, dentro del
 * horario real de apertura de la cancha (`openMinute`/`closeMinute`, de
 * `PublicCourt` — null en cualquiera de los dos significa "no abre este
 * día", y entonces no hay candidatos).
 */
export function buildSlotCandidates(
  dateISO: string,
  durationMinutes: number,
  openMinute: number | null,
  closeMinute: number | null,
  timezone: string,
): SlotCandidate[] {
  const candidates: SlotCandidate[] = [];
  if (openMinute === null || closeMinute === null) return candidates;

  for (
    let minute = openMinute;
    minute + durationMinutes <= closeMinute;
    minute += STEP_MINUTES
  ) {
    const start = zonedMinuteToUtc(dateISO, minute, timezone);
    const startsAtMs = start.getTime();
    candidates.push({
      startMinute: minute,
      startsAt: start.toISOString(),
      startsAtMs,
      endsAtMs: startsAtMs + durationMinutes * 60_000,
    });
  }
  return candidates;
}

/** ¿El horario ya pasó? Mismo criterio que el backend (`start <= now`). */
export function isPastSlot(candidate: SlotCandidate): boolean {
  return candidate.startsAtMs <= Date.now();
}

/** ¿Hay algo ocupado en esta cancha que se solape con el candidato? */
export function isSlotFree(
  candidate: SlotCandidate,
  courtId: string,
  busy: BusyInterval[],
): boolean {
  return !busy.some((b) => {
    if (b.courtId !== courtId) return false;
    const busyStart = new Date(b.startsAt).getTime();
    const busyEnd = new Date(b.endsAt).getTime();
    return candidate.startsAtMs < busyEnd && candidate.endsAtMs > busyStart;
  });
}
