'use client';

import { useEffect, useState } from 'react';
import { ApiError } from './api';

/**
 * Cuenta del jugador (/jugador/cuenta).
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ REUSA /auth/* (el login de STAFF) Y NO UN SISTEMA PROPIO
 * ---------------------------------------------------------------------------
 * `User` (backend) ya es una cuenta de PLATAFORMA, no "de club": un jugador
 * que se registra acá crea la misma fila que crearía un dueño de club al
 * registrarse, solo que sin memberships. `/auth/login` y `/auth/register`
 * ya manejan perfectamente el caso de cero clubes (`activeClub: null`,
 * `clubs: []`, `permissions: []`) — no hace falta backend nuevo para esto,
 * solo un cliente de frontend separado del panel de staff.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ localStorage Y NO sessionStorage (a diferencia de api.ts)
 * ---------------------------------------------------------------------------
 * El panel de staff cierra la sesión al cerrar la pestaña a propósito
 * (compu compartida de recepción). El jugador reserva hoy y vuelve a entrar
 * dentro de tres días desde el mismo celular — forzarlo a loguearse de
 * nuevo cada vez sería peor que no tener cuenta. Mismo criterio que
 * publicStorage.ts, namespaced aparte para no chocar con esas claves.
 *
 * El refresh token sigue viajando en cookie httpOnly (nunca tocado desde
 * JS): Next.js proxea /api/v1/* same-origin en producción (ver
 * next.config.mjs), así que esa cookie viaja igual que en el panel de
 * staff. Por eso esta base NO es la URL directa de Railway como en
 * publicApi.ts — ahí no hace falta cookie (reservas de invitado), acá sí.
 */
const BASE =
  process.env.NODE_ENV === 'development'
    ? (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1')
    : '/api/v1';

export interface PlayerAccount {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}

const STORAGE_KEY = 'clubos.jugador.cuenta';

let accessToken: string | null = null;
let account: PlayerAccount | null = null;
let refreshInFlight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function persist(): void {
  if (typeof window === 'undefined') return;
  try {
    if (account) localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage bloqueado: la cuenta sigue funcionando solo en memoria */
  }
}

function restore(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    account = raw ? (JSON.parse(raw) as PlayerAccount) : null;
  } catch {
    account = null;
  }
}
restore();

function setSession(token: string | null, acc: PlayerAccount | null): void {
  accessToken = token;
  account = acc;
  persist();
  emit();
}

function toAccount(user: {
  id: string; email: string; firstName: string; lastName: string; phone: string | null;
}): PlayerAccount {
  return {
    id: user.id, email: user.email,
    firstName: user.firstName, lastName: user.lastName,
    phone: user.phone ?? null,
  };
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {};
  try { body = await res.json(); } catch { /* respuesta sin cuerpo */ }
  return new ApiError(
    res.status,
    String(body.error ?? 'UNKNOWN'),
    String(body.message ?? `Error ${res.status}`),
    body.details,
  );
}

async function authRequest(
  path: string,
  body: Record<string, unknown>,
): Promise<PlayerAccount> {
  const res = await fetch(`${BASE}/auth${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  const data = await res.json();
  const acc = toAccount(data.user);
  setSession(data.accessToken, acc);
  return acc;
}

export function getAccount(): PlayerAccount | null {
  return account;
}

export function getPlayerAccessToken(): string | null {
  return accessToken;
}

export function subscribePlayerAccount(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const playerAuth = {
  register: (input: {
    email: string; password: string; firstName: string; lastName: string; phone: string;
  }) => authRequest('/register', input),

  login: (input: { email: string; password: string }) =>
    authRequest('/login', input),

  async logout(): Promise<void> {
    try {
      await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {
      /* igual limpiamos el lado del cliente: la cookie puede haber vencido */
    }
    setSession(null, null);
  },

  /**
   * Al montar la app no queda access token en memoria (se perdió al
   * recargar), pero puede seguir viva la cookie de refresh. Solo tiene
   * sentido intentarlo si este dispositivo ya se logueó alguna vez
   * (`account` restaurado de localStorage) — si nunca inició sesión, pegarle
   * a /auth/refresh sería un 401 garantizado en cada carga de página pública.
   */
  async restoreSession(): Promise<void> {
    if (!account || accessToken) return;
    if (refreshInFlight) { await refreshInFlight; return; }

    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (!res.ok) { setSession(null, null); return false; }
        const data = await res.json();
        setSession(data.accessToken, toAccount(data.user));
        return true;
      } catch {
        return false;
      } finally {
        queueMicrotask(() => { refreshInFlight = null; });
      }
    })();

    await refreshInFlight;
  },
};

/** Hook reactivo: null hasta que se loguea, se actualiza en login/logout en toda la app. */
export function usePlayerAccount(): PlayerAccount | null {
  const [snapshot, setSnapshot] = useState<PlayerAccount | null>(account);
  useEffect(() => {
    setSnapshot(account);
    return subscribePlayerAccount(() => setSnapshot(account));
  }, []);
  return snapshot;
}
