'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { publicApi, type PublicUnifiedBooking } from '@/lib/publicApi';
import { getAllPublicBookings, type StoredBooking } from '@/lib/publicStorage';
import { formatLocalDate, formatMinute } from '@/lib/grid';

type SearchLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; reservas: PublicUnifiedBooking[] };

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmada',
  PENDING: 'Pendiente',
  COMPLETED: 'Jugada',
  NO_SHOW: 'No se presentó',
};

function timeRange(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  return `${formatMinute(s.getHours() * 60 + s.getMinutes())} – ${formatMinute(e.getHours() * 60 + e.getMinutes())}`;
}

/**
 * "Mis reservas" de la app unificada: junta lo que este dispositivo
 * recuerda de CUALQUIER club (con link directo al comprobante, que sigue
 * viviendo en /c/[slug]/reservas/[id]) con lo que aparece al buscar por
 * teléfono en TODOS los clubes de la plataforma (sin link — mismo criterio
 * de bajo detalle que la búsqueda de un solo club, ver public.service.ts).
 */
export function PlayerUnifiedBookingsScreen() {
  const [phone, setPhone] = useState('');
  const [search, setSearch] = useState<SearchLoad>({ status: 'idle' });

  const [localList, setLocalList] = useState<(StoredBooking & { slug: string })[]>([]);
  useEffect(() => { setLocalList(getAllPublicBookings()); }, []);

  const localKeys = useMemo(
    () => new Set(localList.map((b) => `${b.slug}:${b.code}`)),
    [localList],
  );

  const runSearch = useCallback(async () => {
    if (!phone.trim()) {
      setSearch({ status: 'error', message: 'Ingresá un teléfono para buscar.' });
      return;
    }
    setSearch({ status: 'loading' });
    try {
      const { reservas } = await publicApi.misReservasJugador(phone.trim());
      setSearch({ status: 'ready', reservas });
    } catch (e) {
      const message = e instanceof ApiError
        ? e.message
        : 'No pudimos buscar tus reservas. Probá de nuevo en un momento.';
      setSearch({ status: 'error', message });
    }
  }, [phone]);

  const phoneOnlyResults = search.status === 'ready'
    ? search.reservas.filter((r) => !localKeys.has(`${r.clubSlug}:${r.code}`))
    : [];

  return (
    <>
      <header className="player-header">
        <div className="player-eyebrow">ClubOS</div>
        <h1 className="player-club-name">Mis reservas</h1>
        <p className="player-tagline">
          Todas tus reservas, en cualquier club de la plataforma — sin cuenta ni contraseña.
        </p>
      </header>

      <section>
        <div className="player-section-title">Reservas en este dispositivo</div>
        {localList.length === 0 ? (
          <p className="field-hint">Todavía no reservaste desde este dispositivo.</p>
        ) : (
          <div className="booking-list">
            {localList.map((b) => (
              <a
                key={`${b.slug}-${b.id}`}
                className="booking-item is-linkable"
                href={`/c/${b.slug}/reservas/${b.id}?token=${encodeURIComponent(b.accessToken)}`}
              >
                <span className="booking-item-dot" style={{ background: b.courtColor || '#0ea5a0' }} />
                <span className="booking-item-main">
                  <span className="booking-item-court">{b.courtName}</span>
                  <span className="booking-item-time">
                    {formatLocalDate(b.startsAt.slice(0, 10))} · {timeRange(b.startsAt, b.endsAt)}
                  </span>
                  <span className="booking-item-hint">{b.slug}</span>
                </span>
                <span className="booking-item-chevron">›</span>
              </a>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="player-section-title">Buscar por teléfono</div>
        <div className="phone-lookup">
          <input
            className="input"
            type="tel"
            inputMode="tel"
            placeholder="El teléfono con el que reservaste"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }}
          />
          <button className="btn btn-primary" disabled={search.status === 'loading'} onClick={() => void runSearch()}>
            {search.status === 'loading' ? <span className="spinner" /> : 'Buscar'}
          </button>
        </div>
        <p className="field-hint" style={{ marginTop: 6 }}>
          Busca en todos los clubes de ClubOS. Para el comprobante completo o cancelar, entrá al club desde
          el link que te enviaron al reservar.
        </p>

        {search.status === 'error' && <div className="alert" style={{ marginTop: 10 }}>{search.message}</div>}

        {search.status === 'ready' && (
          <div className="booking-list" style={{ marginTop: 10 }}>
            {search.reservas.length === 0 && (
              <p className="field-hint">No encontramos reservas próximas con ese teléfono.</p>
            )}
            {phoneOnlyResults.map((r) => (
              <div key={`${r.clubSlug}-${r.code}`} className="booking-item">
                <span className="booking-item-dot" style={{ background: r.courtColor || '#0ea5a0' }} />
                <span className="booking-item-main">
                  <span className="booking-item-court">{r.courtName} · {r.clubName}</span>
                  <span className="booking-item-time">
                    {formatLocalDate(r.startsAt.slice(0, 10))} · {timeRange(r.startsAt, r.endsAt)}
                  </span>
                  <span className="booking-item-hint">
                    {STATUS_LABEL[r.status] ?? r.status} · comprobante no disponible en este dispositivo
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
