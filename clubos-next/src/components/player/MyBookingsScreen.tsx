'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { publicApi, type PublicBookingSummary } from '@/lib/publicApi';
import { getPublicBookings, type StoredBooking } from '@/lib/publicStorage';
import { formatLocalDate, formatMinute } from '@/lib/grid';

type SearchLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; reservas: PublicBookingSummary[] };

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
 * "Mis reservas": lo que este dispositivo recuerda (con link al comprobante)
 * más lo que aparece al buscar por teléfono (sin link — esa consulta es a
 * propósito de bajo detalle, ver public.service.ts).
 */
export function MyBookingsScreen({ slug }: { slug: string }) {
  const [phone, setPhone] = useState('');
  const [search, setSearch] = useState<SearchLoad>({ status: 'idle' });

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

  const runSearch = useCallback(async () => {
    if (!phone.trim()) {
      setSearch({ status: 'error', message: 'Ingresá un teléfono para buscar.' });
      return;
    }
    setSearch({ status: 'loading' });
    try {
      const { reservas } = await publicApi.misReservas(slug, phone.trim());
      setSearch({ status: 'ready', reservas });
    } catch (e) {
      const message = e instanceof ApiError
        ? e.message
        : 'No pudimos buscar tus reservas. Probá de nuevo en un momento.';
      setSearch({ status: 'error', message });
    }
  }, [slug, phone]);

  // Lo que aparece por teléfono pero NO está ya en la lista de este
  // dispositivo (para no mostrar la misma reserva dos veces).
  const phoneOnlyResults = search.status === 'ready'
    ? search.reservas.filter((r) => !localCodes.has(r.code))
    : [];

  return (
    <>
      <header className="player-header">
        <div className="player-eyebrow">ClubOS</div>
        <h1 className="player-club-name">Mis reservas</h1>
        <p className="player-tagline">Sin cuenta ni contraseña: encontrá tus reservas por teléfono o desde este dispositivo.</p>
      </header>

      <section>
        <div className="player-section-title">Reservas en este dispositivo</div>
        {localList.length === 0 ? (
          <p className="field-hint">Todavía no reservaste desde este dispositivo.</p>
        ) : (
          <div className="booking-list">
            {localList.map((b) => (
              <a key={b.id} className="booking-item is-linkable" href={`/c/${slug}/reservas/${b.id}?token=${encodeURIComponent(b.accessToken)}`}>
                <span className="booking-item-dot" style={{ background: b.courtColor || '#c8443e' }} />
                <span className="booking-item-main">
                  <span className="booking-item-court">{b.courtName}</span>
                  <span className="booking-item-time">
                    {formatLocalDate(b.startsAt.slice(0, 10))} · {timeRange(b.startsAt, b.endsAt)}
                  </span>
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
          Esta búsqueda solo confirma qué reservaste — para ver el detalle completo o cancelar, usá el link que te enviamos al reservar.
        </p>

        {search.status === 'error' && <div className="alert" style={{ marginTop: 10 }}>{search.message}</div>}

        {search.status === 'ready' && (
          <div className="booking-list" style={{ marginTop: 10 }}>
            {search.reservas.length === 0 && (
              <p className="field-hint">No encontramos reservas próximas con ese teléfono.</p>
            )}
            {phoneOnlyResults.map((r) => (
              <div key={r.code} className="booking-item">
                <span className="booking-item-dot" style={{ background: r.courtColor || '#c8443e' }} />
                <span className="booking-item-main">
                  <span className="booking-item-court">{r.courtName}</span>
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

      <a className="player-nav-link" href={`/c/${slug}`}>← Volver a reservar</a>
    </>
  );
}
