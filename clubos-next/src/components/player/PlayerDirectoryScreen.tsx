'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { publicApi, type PublicClubDirectoryEntry } from '@/lib/publicApi';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; clubes: PublicClubDirectoryEntry[] };

/**
 * Directorio de clubes: punto de entrada de la app unificada. El jugador
 * busca su club (por nombre o ciudad) y entra a SU página de reserva
 * (/c/[slug]) — esta pantalla no reserva nada, solo ayuda a encontrar.
 */
export function PlayerDirectoryScreen() {
  const [term, setTerm] = useState('');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = useCallback(async (q: string) => {
    setLoad({ status: 'loading' });
    try {
      const { clubes } = await publicApi.directorio(q);
      setLoad({ status: 'ready', clubes });
    } catch (e) {
      const message = e instanceof ApiError
        ? e.message
        : 'No pudimos cargar los clubes. Probá de nuevo en un momento.';
      setLoad({ status: 'error', message });
    }
  }, []);

  useEffect(() => { void search(''); }, [search]);

  const onChange = (v: string) => {
    setTerm(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void search(v), 260);
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <>
      <header className="player-header">
        <div className="player-eyebrow">ClubOS</div>
        <h1 className="player-club-name">Encontrá tu club</h1>
        <p className="player-tagline">
          Buscá cualquier club de pádel de la plataforma. Una sola app para todos.
        </p>
      </header>

      <section>
        <input
          className="search-input"
          value={term}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Nombre del club o ciudad"
          autoComplete="off"
          aria-label="Buscar club"
        />
      </section>

      {load.status === 'loading' && (
        <div className="player-state" style={{ minHeight: 'auto', padding: '32px 16px' }}>
          <div className="spinner" />
        </div>
      )}

      {load.status === 'error' && (
        <div className="player-state" style={{ minHeight: 'auto', padding: '32px 16px' }}>
          <div className="state-icon">⚠️</div>
          <p>{load.message}</p>
          <button className="btn btn-secondary" onClick={() => void search(term)}>Reintentar</button>
        </div>
      )}

      {load.status === 'ready' && (
        <section>
          {load.clubes.length === 0 && (
            <p className="field-hint" style={{ textAlign: 'center', padding: '24px 0' }}>
              No encontramos ningún club con &quot;{term}&quot;.
            </p>
          )}
          <div className="booking-list">
            {load.clubes.map((c) => (
              <a key={c.slug} className="booking-item is-linkable" href={`/c/${c.slug}`}>
                {c.logoUrl ? (
                  <img src={c.logoUrl} alt="" className="club-directory-avatar" />
                ) : (
                  <span className="club-directory-avatar club-directory-avatar-fallback">
                    {c.name[0]?.toUpperCase() ?? 'C'}
                  </span>
                )}
                <span className="booking-item-main">
                  <span className="booking-item-court">{c.name}</span>
                  {c.city && (
                    <span className="booking-item-time">
                      {c.city}{c.state ? `, ${c.state}` : ''}
                    </span>
                  )}
                </span>
                <span className="booking-item-chevron">›</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
