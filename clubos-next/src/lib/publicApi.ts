/**
 * Cliente de la API PÚBLICA de ClubOS (portal del jugador).
 *
 * A diferencia de `api.ts` (el cliente del panel de staff), acá NO hay
 * sesión: nada de Authorization, nada de x-club-id, nada de cookies. Los
 * endpoints son `@Public()` en el backend — cualquier header de sesión de
 * staff que viajara igual no haría nada, pero mandamos `credentials: 'omit'`
 * de forma explícita para que quede claro (y sea cierto) que este portal
 * funciona con cero cookies/tokens de la app de staff, aunque el jugador
 * tenga esa sesión abierta en la misma compu.
 *
 * Reutiliza `ApiError` de `api.ts`: es una clase simple sin estado de
 * sesión, así que compartirla mantiene el mismo contrato de errores
 * (status, code, message) en toda la app.
 */
import { ApiError } from './api';

// Fijo en vez de leído de NEXT_PUBLIC_API_URL a propósito: una variable de
// entorno puesta en el dashboard de Vercel le gana siempre a .env.production
// del repo (process.env ya la trae seteada antes de que Next cargue el
// archivo) y terminamos sirviendo un valor de ejemplo baked-in en
// producción. Un literal en el código no tiene ninguna variable que lo
// pueda pisar.
const BASE =
  process.env.NODE_ENV === 'development'
    ? (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1')
    : 'https://padel-production-f5ff.up.railway.app/api/v1';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    // fetch tira si no hay red o el backend no responde en absoluto —
    // distinto de un 4xx/5xx, que sí llega con respuesta.
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'No pudimos conectarnos con el servidor. Revisá tu conexión e intentá de nuevo.',
    );
  }

  // Los endpoints públicos están limitados por IP para evitar abuso. Un 429
  // no es un error del jugador ni algo que romper la pantalla: es "esperá un
  // toque".
  if (res.status === 429) {
    throw new ApiError(
      429,
      'RATE_LIMITED',
      'Demasiados intentos. Probá de nuevo en un momento.',
    );
  }

  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try { body = await res.json(); } catch { /* respuesta sin cuerpo */ }
    throw new ApiError(
      res.status,
      String(body.error ?? 'UNKNOWN'),
      String(body.message ?? `Error ${res.status}`),
      body.details,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Tipos que devuelve la API pública
// ---------------------------------------------------------------------------

export interface PublicClub {
  id: string;
  name: string;
  slug: string;
}

export interface PublicCourt {
  id: string;
  name: string;
  number: number;
  color: string;
  environment: string;
  /** Minuto del día (huso del club) en que abre/cierra HOY. null = no abre. */
  openMinute: number | null;
  closeMinute: number | null;
}

export interface PublicBusyInterval {
  courtId: string;
  startsAt: string;
  endsAt: string;
}

export interface PublicAvailability {
  club: PublicClub;
  date: string;
  courts: PublicCourt[];
  busy: PublicBusyInterval[];
}

export interface PublicBookingCreated {
  ok: true;
  booking: {
    id: string;
    code: string;
    totalPrice: number;
    /** Se devuelve UNA sola vez: es el único comprobante de dueño de esta reserva. */
    accessToken: string;
  };
}

/** Fila de /mis-reservas: deliberadamente pobre en detalle (ver public.service.ts). */
export interface PublicBookingSummary {
  code: string;
  startsAt: string;
  endsAt: string;
  status: string;
  courtName: string;
  courtColor: string | null;
}

/** Detalle completo / comprobante, gateado por accessToken. */
export interface PublicBookingDetail {
  id: string;
  code: string;
  startsAt: string;
  endsAt: string;
  status: string;
  paymentStatus: string;
  totalPrice: number;
  paidAmount: number;
  courtName: string;
  courtColor: string | null;
}

/** Producto del buffet: solo lo que un jugador necesita para decidir qué pedir en el mostrador. */
export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string;
  imageUrl: string | null;
}

/** Fila de /torneos: lo justo para decidir si entrar al detalle. */
export interface PublicTournamentSummary {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  format: string;
  category: string | null;
  skillLevel: string | null;
  startsAt: string;
  endsAt: string | null;
  status: string;
  entryFee: number;
  spotsLeft: number;
  registrationOpen: boolean;
}

export interface PublicTournamentDetail extends PublicTournamentSummary {
  prizeDescription: string | null;
  rules: string | null;
  teams: { id: string; name: string; seed: number | null }[];
}

export interface PublicTeamPlayer {
  firstName: string;
  lastName?: string;
  phone: string;
}

export interface PublicTeamCreated {
  ok: true;
  team: {
    id: string;
    name: string;
    entryFee: number;
    /** Se devuelve UNA sola vez: es el comprobante para pagar/consultar después. */
    accessToken: string;
  };
}

export interface PublicTeamDetail {
  id: string;
  name: string;
  paymentStatus: string;
  entryFee: number;
  tournamentName: string;
  tournamentStartsAt: string;
  players: string[];
}

/** Fila del directorio de clubes (app unificada /jugador). */
export interface PublicClubDirectoryEntry {
  slug: string;
  name: string;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
}

/** Fila de "mis reservas" a través de TODOS los clubes (app unificada). */
export interface PublicUnifiedBooking {
  clubSlug: string;
  clubName: string;
  code: string;
  startsAt: string;
  endsAt: string;
  status: string;
  courtName: string;
  courtColor: string | null;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const publicApi = {
  getClub: (slug: string) =>
    request<PublicClub>(`/public/clubs/${encodeURIComponent(slug)}`),

  availability: (slug: string, date: string) =>
    request<PublicAvailability>(
      `/public/clubs/${encodeURIComponent(slug)}/availability?date=${encodeURIComponent(date)}`,
    ),

  reservar: (
    slug: string,
    input: {
      courtId: string;
      startsAt: string;
      durationMinutes: number;
      firstName: string;
      lastName?: string;
      phone: string;
    },
  ) =>
    request<PublicBookingCreated>(`/public/clubs/${encodeURIComponent(slug)}/reservar`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  misReservas: (slug: string, phone: string) =>
    request<{ reservas: PublicBookingSummary[] }>(
      `/public/clubs/${encodeURIComponent(slug)}/mis-reservas?phone=${encodeURIComponent(phone)}`,
    ),

  consultar: (slug: string, id: string, token: string) =>
    request<PublicBookingDetail>(
      `/public/clubs/${encodeURIComponent(slug)}/reservas/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`,
    ),

  checkout: (slug: string, id: string, accessToken: string) =>
    request<{ initPoint: string }>(
      `/public/clubs/${encodeURIComponent(slug)}/reservas/${encodeURIComponent(id)}/checkout`,
      { method: 'POST', body: JSON.stringify({ accessToken }) },
    ),

  cancelar: (slug: string, id: string, accessToken: string) =>
    request<{ ok: true }>(
      `/public/clubs/${encodeURIComponent(slug)}/reservas/${encodeURIComponent(id)}/cancelar`,
      { method: 'POST', body: JSON.stringify({ accessToken }) },
    ),

  menu: (slug: string) =>
    request<{ productos: PublicProduct[] }>(
      `/public/clubs/${encodeURIComponent(slug)}/productos`,
    ),

  tournaments: (slug: string) =>
    request<{ torneos: PublicTournamentSummary[] }>(
      `/public/clubs/${encodeURIComponent(slug)}/torneos`,
    ),

  tournamentDetail: (slug: string, id: string) =>
    request<PublicTournamentDetail>(
      `/public/clubs/${encodeURIComponent(slug)}/torneos/${encodeURIComponent(id)}`,
    ),

  inscribirEquipo: (
    slug: string,
    tournamentId: string,
    input: { teamName: string; players: PublicTeamPlayer[] },
  ) =>
    request<PublicTeamCreated>(
      `/public/clubs/${encodeURIComponent(slug)}/torneos/${encodeURIComponent(tournamentId)}/inscribir`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  equipoDetalle: (slug: string, teamId: string, token: string) =>
    request<PublicTeamDetail>(
      `/public/clubs/${encodeURIComponent(slug)}/equipos/${encodeURIComponent(teamId)}?token=${encodeURIComponent(token)}`,
    ),

  checkoutInscripcion: (slug: string, teamId: string, accessToken: string) =>
    request<{ initPoint: string }>(
      `/public/clubs/${encodeURIComponent(slug)}/equipos/${encodeURIComponent(teamId)}/checkout`,
      { method: 'POST', body: JSON.stringify({ accessToken }) },
    ),

  // -------------------------------------------------------------------
  // App unificada (/jugador) — no van por slug, recorren toda la plataforma.
  // -------------------------------------------------------------------

  directorio: (q?: string) =>
    request<{ clubes: PublicClubDirectoryEntry[] }>(
      `/public/jugador/clubes${q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
    ),

  misReservasJugador: (phone: string) =>
    request<{ reservas: PublicUnifiedBooking[] }>(
      `/public/jugador/mis-reservas?phone=${encodeURIComponent(phone)}`,
    ),
};
