'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { publicApi, type PublicUnifiedBooking } from '@/lib/publicApi';
import { getPublicBookings, type StoredBooking } from '@/lib/publicStorage';
import { formatLocalDate, formatMinute } from '@/lib/grid';
import { getFreshPlayerAccessToken, usePlayerAccount } from '@/lib/playerAuth';

/**
 * El comprobante guardado en el dispositivo no tiene estado (se guardó tal
 * cual quedó al reservar). Sin esto, un turno cancelado por el club después
 * sigue mostrándose como si nada en esta lista — recién se ve al entrar al
 * detalle. Se pide el estado real de cada uno al abrir la pantalla.
 */
function useLiveStatuses(slug: string, bookings: StoredBooking[]) {
  const [statuses, setStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    if (bookings.length === 0) return;
    let cancelled = false;
    Promise.all(
      bookings.map(async (b) => {
        try {
          const detail = await publicApi.consultar(slug, b.id, b.accessToken);
          return [b.id, detail.status] as const;
        } catch {
          return null; // token vencido, reserva no encontrada, etc.: se omite.
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const r of results) if (r) next[r[0]] = r[1];
      setStatuses(next);
    });
    return () => { cancelled = true; };
  }, [slug, bookings]);

  return statuses;
}

type AccountSearchLoad =
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

/**
 * "Mis reservas" de este club: las de la cuenta logueada (filtradas a este
 * `slug` — el endpoint de la cuenta es cross-club, igual que /jugador) más
 * lo que este dispositivo recuerda, con link directo al comprobante.
 *
 * `account` siempre está: `PlayerAuthGate`, en la ruta, no renderiza esta
 * pantalla sin cuenta logueada.
 */
export function MyBookingsScreen({ slug }: { slug: string }) {
  const account = usePlayerAccount();

  const [accountSearch, setAccountSearch] = useState<AccountSearchLoad>({ status: 'idle' });
  useEffect(() => {
    if (!account) return;
    let stale = false;
    setAccountSearch({ status: 'loading' });
    getFreshPlayerAccessToken()
      .then((token) => publicApi.misReservasDeCuenta(token ?? ''))
      .then(({ reservas }) => {
        if (stale) return;
        setAccountSearch({
          status: 'ready',
          reservas: reservas.filter((r) => r.clubSlug === slug),
        });
      })
      .catch((e) => {
        if (stale) return;
        const message = e instanceof ApiError
          ? e.message
          : 'No pudimos cargar las reservas de tu cuenta.';
        setAccountSearch({ status: 'error', message });
      });
    return () => { stale = true; };
  }, [account, slug]);

  // Se lee en un efecto (no durante el render): localStorage no existe en el
  // servidor, así que leerlo directo en el cuerpo del componente produce un
  // HTML de servidor distinto del de cliente apenas hay algo guardado —
  // mismatch de hidratación. El array vacío inicial coincide en ambos lados.
  const [localList, setLocalList] = useState<StoredBooking[]>([]);
  useEffect(() => {
    setLocalList(
      getPublicBookings(slug).sort(
        (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      ),
    );
  }, [slug]);

  const localCodes = useMemo(() => new Set(localList.map((b) => b.code)), [localList]);
  const localStatuses = useLiveStatuses(slug, localList);

  const accountOnlyResults = accountSearch.status === 'ready'
    ? accountSearch.reservas.filter((r) => !localCodes.has(r.code))
    : [];

  if (!account) return null;

  return (
    <>
      <header className="player-header">
        <div className="player-eyebrow">PadelApp2</div>
        <h1 className="player-club-name">Mis reservas</h1>
        <p className="player-tagline">Las reservas de tu cuenta en este club.</p>
      </header>

      <section>
        <div className="player-section-title">Reservas de tu cuenta</div>
        {accountSearch.status === 'loading' && (
          <div className="player-state" style={{ minHeight: 'auto', padding: '16px 0' }}>
            <div className="spinner" />
          </div>
        )}
        {accountSearch.status === 'error' && <div className="alert">{accountSearch.message}</div>}
        {accountSearch.status === 'ready' && (
          <div className="booking-list">
            {accountSearch.reservas.length === 0 && (
              <p className="field-hint">Todavía no tenés reservas futuras con esta cuenta en este club.</p>
            )}
            {accountOnlyResults.map((r) => (
              <div key={`acc-${r.code}`} className="booking-item">
                <span className="booking-item-dot" style={{ background: r.courtColor || '#0ea5a0' }} />
                <span className="booking-item-main">
                  <span className="booking-item-court">{r.courtName}</span>
                  <span className="booking-item-time">
                    {formatLocalDate(r.startsAt.slice(0, 10))} · {timeRange(r.startsAt, r.endsAt)}
                  </span>
                  <span className="booking-item-hint">
                    {STATUS_LABEL[r.status] ?? r.status}
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
                  key={b.id}
                  className={`booking-item is-linkable${isCancelled ? ' is-cancelled' : ''}`}
                  href={`/c/${slug}/reservas/${b.id}?token=${encodeURIComponent(b.accessToken)}`}
                >
                  <span className="booking-item-dot" style={{ background: b.courtColor || '#c8443e' }} />
                  <span className="booking-item-main">
                    <span className="booking-item-court">{b.courtName}</span>
                    <span className="booking-item-time">
                      {formatLocalDate(b.startsAt.slice(0, 10))} · {timeRange(b.startsAt, b.endsAt)}
                    </span>
                    {status && (
                      <span className={`booking-item-hint${isCancelled ? ' is-cancelled' : ''}`}>
                        {STATUS_LABEL[status] ?? status}
                      </span>
                    )}
                  </span>
                  <span className="booking-item-chevron">›</span>
                </a>
              );
            })}
          </div>
        )}
      </section>

      <a className="player-nav-link" href={`/c/${slug}`}>← Volver a reservar</a>
    </>
  );
}
