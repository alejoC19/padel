'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { publicApi, type PublicTournamentSummary } from '@/lib/publicApi';
import { formatLocalDate, formatMinute, formatMoney } from '@/lib/grid';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; torneos: PublicTournamentSummary[] };

const FORMAT_LABEL: Record<string, string> = {
  ELIMINATION: 'Eliminación directa',
  DOUBLE_ELIMINATION: 'Doble eliminación',
  ROUND_ROBIN: 'Todos contra todos',
  GROUPS_PLAYOFF: 'Grupos + playoff',
  AMERICANO: 'Americano',
};

function startLabel(iso: string): string {
  const d = new Date(iso);
  const minute = d.getHours() * 60 + d.getMinutes();
  return `${formatLocalDate(iso.slice(0, 10))} · ${formatMinute(minute)} hs`;
}

/** Torneos con inscripción abierta o próximos a jugarse. */
export function PlayerTournamentsScreen({ slug }: { slug: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const fetchTournaments = useCallback(async () => {
    setLoad({ status: 'loading' });
    try {
      const { torneos } = await publicApi.tournaments(slug);
      setLoad({ status: 'ready', torneos });
    } catch (e) {
      const message = e instanceof ApiError
        ? e.message
        : 'No pudimos cargar los torneos. Probá de nuevo en un momento.';
      setLoad({ status: 'error', message });
    }
  }, [slug]);

  useEffect(() => { void fetchTournaments(); }, [fetchTournaments]);

  if (load.status === 'loading') {
    return (
      <div className="player-state">
        <div className="spinner" />
        <p>Cargando torneos…</p>
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <div className="player-state">
        <div className="state-icon">⚠️</div>
        <h2>Algo salió mal</h2>
        <p>{load.message}</p>
        <button className="btn btn-primary" onClick={() => void fetchTournaments()}>Reintentar</button>
      </div>
    );
  }

  return (
    <>
      <header className="player-header">
        <div className="player-eyebrow">Torneos</div>
        <h1 className="player-club-name">Anotate a jugar</h1>
      </header>

      {load.torneos.length === 0 && (
        <div className="player-state" style={{ minHeight: 'auto', padding: '32px 16px' }}>
          <div className="state-icon">🏆</div>
          <p>No hay torneos abiertos por ahora. Volvé a mirar pronto.</p>
        </div>
      )}

      <section>
        {load.torneos.map((t) => (
          <a key={t.id} href={`/c/${slug}/torneos/${t.id}`} className="tournament-card">
            <div className="tournament-card-name">{t.name}</div>
            <div className="tournament-card-meta">
              <span>{startLabel(t.startsAt)}</span>
              <span>{FORMAT_LABEL[t.format] ?? t.format}</span>
              {t.category && <span>{t.category}</span>}
            </div>
            <div className="tournament-card-foot">
              <span className="tournament-fee">
                {t.entryFee > 0 ? formatMoney(t.entryFee) : 'Gratis'}
              </span>
              <span className={`badge ${t.registrationOpen ? 'success' : 'warning'}`}>
                {t.registrationOpen ? `${t.spotsLeft} lugares` : 'Cerrado'}
              </span>
            </div>
          </a>
        ))}
      </section>
    </>
  );
}
