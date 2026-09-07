/**
 * Comprobantes del jugador guardados en ESTE dispositivo.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ localStorage Y NO sessionStorage
 * ---------------------------------------------------------------------------
 * El cliente de staff (`api.ts`) usa sessionStorage a propósito: la sesión no
 * debe sobrevivir cerrar la pestaña en una recepción con compu compartida.
 * Acá es lo opuesto — el jugador reserva hoy y quiere encontrar su
 * comprobante dentro de tres días, quizás habiendo cerrado el navegador. Por
 * eso localStorage, namespaced por club (slug) para no mezclar reservas de
 * distintos clubes en el mismo dispositivo.
 *
 * ---------------------------------------------------------------------------
 * QUÉ GUARDAMOS Y POR QUÉ
 * ---------------------------------------------------------------------------
 * El accessToken viaja UNA sola vez, en la respuesta de `reservar`. La URL
 * de confirmación ya lo embebe (?token=...), así que esto es el respaldo
 * para cuando el jugador perdió el link (cerró la pestaña sin guardar,
 * cambió de navegador en el mismo dispositivo, etc.) — no la fuente
 * primaria de verdad.
 */

export interface StoredBooking {
  id: string;
  code: string;
  accessToken: string;
  startsAt: string;
  endsAt: string;
  courtName: string;
  courtColor: string | null;
  createdAt: string;
}

const MAX_PER_CLUB = 30;

function storageKey(slug: string): string {
  return `clubos.public.${slug}.bookings`;
}

export function getPublicBookings(slug: string): StoredBooking[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredBooking[]) : [];
  } catch {
    // localStorage bloqueado (modo privado, cuota, etc.): el jugador sigue
    // pudiendo usar el link con el token, solo pierde el respaldo local.
    return [];
  }
}

export function getPublicBooking(slug: string, id: string): StoredBooking | undefined {
  return getPublicBookings(slug).find((b) => b.id === id);
}

export function savePublicBooking(slug: string, booking: StoredBooking): void {
  if (typeof window === 'undefined') return;
  try {
    const rest = getPublicBookings(slug).filter((b) => b.id !== booking.id);
    const next = [booking, ...rest].slice(0, MAX_PER_CLUB);
    localStorage.setItem(storageKey(slug), JSON.stringify(next));
  } catch {
    /* noop: el comprobante sigue siendo válido vía el link con el token */
  }
}
