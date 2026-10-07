'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { publicApi, type PublicUnifiedBooking } from '@/lib/publicApi';
import { getAllPublicBookings, type StoredBooking } from '@/lib/publicStorage';
import { formatLocalDate, formatMinute } from '@/lib/grid';
import { getFreshPlayerAccessToken, usePlayerAccount } from '@/lib/playerAuth';

type SearchLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; reservas: PublicUnifiedBooking[] };

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  PAID: 'Pagada',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Jugada',
  NO_SHOW: 'No se presentó',
  CANCELLED_BY_CLIENT: 'Cancelada por vos',
  CANCELLED_BY_CLUB: 'Cancelada por el club',
};

function timeRange(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  return `${formatMinute(s.getHours() * 60 + s.getMinutes())} – ${formatMinute(e.getHours() * 60 + e.getMinutes())}`;
}

/** Mismo motivo que en MyBookingsScreen: el comprobante local no tiene estado. */
function useLiveStatuses(bookings: (StoredBooking & { slug: string })[]) {
  const [statuses, setStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    if (bookings.length === 0) return;
    let cancelled = false;
    Promise.all(
      bookings.map(async (b) => {
        try {
          const detail = await publicApi.consultar(b.slug, b.id, b.accessToken);
          return [b.id, detail.status] as const;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const r of results) if (r) next[r[0]] = r[1];
      setStatuses(next);
    });
    return () => { cancelled = true; };
  }, [bookings]);

  return statuses;
}

/**
 * "Mis reservas" de la app unificada: las de la cuenta logueada (en TODOS
 * los clubes de la plataforma) más lo que este dispositivo recuerda, con
 * link directo al comprobante (que sigue viviendo en
 * /c/[slug]/reservas/[id], accesible sin cuenta vía su token).
 *
 * `account` siempre está: `PlayerAuthGate`, en el layout de /jugador, no
 * renderiza esta pantalla sin cuenta logueada.
 */
export function PlayerUnifiedBookingsScreen() {
  const account = usePlayerAccount();

  const [accountSearch, setAccountSearch] = useState<SearchLoad>({ status: 'idle' });
  useEffect(() => {
    if (!account) return;
    let stale = false;
    setAccountSearch({ status: 'loading' });
    getFreshPlayerAccessToken()
      .then((token) => publicApi.misReservasDeCuenta(token ?? ''))
      .then(({ reservas }) => { if (!stale) setAccountSearch({ status: 'ready', reservas }); })
      .catch((e) => {
        if (stale) return;
        const message = e instanceof ApiError
          ? e.message
          : 'No pudimos cargar las reservas de tu cuenta.';
        setAccountSearch({ status: 'error', message });
      });
    return () => { stale = true; };
  }, [account]);

  const [localList, setLocalList] = useState<(StoredBooking & { slug: string })[]>([]);
  useEffect(() => { setLocalList(getAllPublicBookings()); }, []);

  const localKeys = useMemo(
    () => new Set(localList.map((b) => `${b.slug}:${b.code}`)),
    [localList],
  );
  const localStatuses = useLiveStatuses(localList);

  const accountOnlyResults = accountSearch.status === 'ready'
    ? accountSearch.reservas.filter((r) => !localKeys.has(`${r.clubSlug}:${r.code}`))
    : [];

  if (!account) return null;

  return (
    <>
      <header className="player-header">
        <div className="player-eyebrow">PadelApp2</div>
        <h1 className="player-club-name">Mis reservas</h1>
        <p className="player-tagline">
          Todas tus reservas, en cualquier club de la plataforma.
        </p>
      </header>

      <section>
        <div className="player-section-title">Reservas de tu cuenta</div>
        {accountSearch.status === 'loading' && (
          <div className="player-state" style={{ minHeight: 'auto', padding: '16px 0' }}>
            <div className="spinner" />
          </div>
        )}
        {accountSearch.status === 'error' && (
          <div className="alert">{accountSearch.message}</div>
        )}
        {accountSearch.status === 'ready' && (
          <div className="booking-list">
            {accountSearch.reservas.length === 0 && (
              <p className="field-hint">Todavía no tenés reservas futuras con esta cuenta.</p>
            )}
            {accountOnlyResults.map((r) => (
              <div key={`acc-${r.clubSlug}-${r.code}`} className="booking-item">
                <span className="booking-item-dot" style={{ background: r.courtColor || '#0ea5a0' }} />
                <span className="booking-item-main">
                  <span className="booking-item-court">{r.courtName} · {r.clubName}</span>
                  <span className="booking-item-time">
                    {formatLocalDate(r.startsAt.slice(0, 10))} · {timeRange(r.startsAt, r.endsAt)}
                  </span>
                  <span className="booking-item-hint">
                    {STATUS_LABEL[r.status] ?? r.status} · entrá al club para el comprobante completo
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="player-section-title">Reservas en este dispositivo</div>
        {localList.length === 0 ? (
          <p className="field-hint">Todavía no reservaste desde este dispositivo.</p>
        ) : (
          <div className="booking-list">
            {localList.map((b) => {
              const status = localStatuses[b.id];
              const isCancelled = status?.startsWith('CANCELLED');
              return (
                <a
                  key={`${b.slug}-${b.id}`}
                  className={`booking-item is-linkable${isCancelled ? ' is-cancelled' : ''}`}
                  href={`/c/${b.slug}/reservas/${b.id}?token=${encodeURIComponent(b.accessToken)}`}
                >
                  <span className="booking-item-dot" style={{ background: b.courtColor || '#de6435' }} />
                  <span className="booking-item-main">
                    <span className="booking-item-court">{b.courtName}</span>
                    <span className="booking-item-time">
                      {formatLocalDate(b.startsAt.slice(0, 10))} · {timeRange(b.startsAt, b.endsAt)}
                    </span>
                    <span className={`booking-item-hint${isCancelled ? ' is-cancelled' : ''}`}>
                      {isCancelled ? (STATUS_LABEL[status!] ?? status) : b.slug}
                    </span>
                  </span>
                  <span className="booking-item-chevron">›</span>
                </a>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
