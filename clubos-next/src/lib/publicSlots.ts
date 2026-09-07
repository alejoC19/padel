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
 * Para no inventar una dependencia de timezone que el backend no da acá,
 * este módulo evita esa conversión por completo: arma cada horario candidato
 * como una fecha LOCAL del navegador (`new Date(year, month, day, h, m)`) y
 * compara instantes absolutos (epoch ms) contra los `busy` que llegan en
 * ISO/UTC. Esto asume que el dispositivo del jugador está en el mismo huso
 * horario que el club — supuesto razonable para alguien reservando una
 * cancha para jugar ahí en persona, y el mismo supuesto implícito que hace
 * cualquier reloj de pared. Documentado acá como decisión consciente.
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
export const ALLOWED_DURATIONS = [60, 90, 120] as const;
export type AllowedDuration = (typeof ALLOWED_DURATIONS)[number];

/** Paso de la grilla. 30' para que las duraciones de 60/90/120 calcen. */
const STEP_MINUTES = 30;

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
): SlotCandidate[] {
  const candidates: SlotCandidate[] = [];
  if (openMinute === null || closeMinute === null) return candidates;

  const { year, month, day } = parseDateISO(dateISO);

  for (
    let minute = openMinute;
    minute + durationMinutes <= closeMinute;
    minute += STEP_MINUTES
  ) {
    const h = Math.floor(minute / 60);
    const m = minute % 60;
    const start = new Date(year, month - 1, day, h, m, 0, 0);
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
