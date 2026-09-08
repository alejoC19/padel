'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api';
import {
  publicApi, type PublicTeamPlayer, type PublicTournamentDetail,
} from '@/lib/publicApi';
import { savePublicTeam } from '@/lib/publicStorage';
import { formatLocalDate, formatMinute, formatMoney } from '@/lib/grid';

type Load =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; t: PublicTournamentDetail };

const FORMAT_LABEL: Record<string, string> = {
  ELIMINATION: 'Eliminación directa',
  DOUBLE_ELIMINATION: 'Doble eliminación',
  ROUND_ROBIN: 'Todos contra todos',
  GROUPS_PLAYOFF: 'Grupos + playoff',
  AMERICANO: 'Americano',
};

const MAX_PLAYERS = 4;

function emptyPlayer(): PublicTeamPlayer {
  return { firstName: '', lastName: '', phone: '' };
}

/** Detalle de un torneo + formulario para anotar un equipo (pádel: dobles). */
export function PlayerTournamentDetailScreen({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const [showForm, setShowForm] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [players, setPlayers] = useState<PublicTeamPlayer[]>([emptyPlayer(), emptyPlayer()]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoad({ status: 'loading' });
    try {
      const t = await publicApi.tournamentDetail(slug, id);
      setLoad({ status: 'ready', t });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setLoad({ status: 'not-found' });
      } else {
        const message = e instanceof ApiError
          ? e.message
          : 'No pudimos cargar el torneo. Probá de nuevo en un momento.';
        setLoad({ status: 'error', message });
      }
    }
  }, [slug, id]);

  useEffect(() => { void fetchDetail(); }, [fetchDetail]);

  const updatePlayer = (i: number, patch: Partial<PublicTeamPlayer>) => {
    setPlayers((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };

  const submit = useCallback(async () => {
    if (load.status !== 'ready') return;
    if (!teamName.trim()) {
      setFormError('Ponele un nombre al equipo.');
      return;
    }
    for (const p of players) {
      if (!p.firstName.trim() || !p.phone.trim()) {
        setFormError('Nombre y teléfono son obligatorios para cada jugador.');
        return;
      }
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await publicApi.inscribirEquipo(slug, id, {
        teamName: teamName.trim(),
        players: players.map((p) => ({
          firstName: p.firstName.trim(),
          lastName: p.lastName?.trim() || undefined,
          phone: p.phone.trim(),
        })),
      });

      savePublicTeam(slug, {
        id: res.team.id,
        name: res.team.name,
        tournamentId: id,
        tournamentName: load.t.name,
        accessToken: res.team.accessToken,
        createdAt: new Date().toISOString(),
      });

      router.push(
        `/c/${slug}/equipos/${res.team.id}?token=${encodeURIComponent(res.team.accessToken)}`,
      );
    } catch (e) {
      setFormError(
        e instanceof ApiError ? e.message : 'No pudimos completar la inscripción. Probá de nuevo.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [load, teamName, players, slug, id, router]);

  if (load.status === 'loading') {
    return (
      <div className="player-state">
        <div className="spinner" />
        <p>Cargando torneo…</p>
      </div>
    );
  }

  if (load.status === 'not-found') {
    return (
      <div className="player-state">
        <div className="state-icon">🔎</div>
        <h2>Torneo no encontrado</h2>
        <a className="btn btn-secondary" href={`/c/${slug}/torneos`}>Ver otros torneos</a>
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <div className="player-state">
        <div className="state-icon">⚠️</div>
        <h2>Algo salió mal</h2>
        <p>{load.message}</p>
        <button className="btn btn-primary" onClick={() => void fetchDetail()}>Reintentar</button>
      </div>
    );
  }

  const { t } = load;
  const start = new Date(t.startsAt);

  return (
    <>
      <header className="player-header">
        <div className="player-eyebrow">Torneo</div>
        <h1 className="player-club-name">{t.name}</h1>
        {t.description && <p className="player-tagline">{t.description}</p>}
      </header>

      <section className="card">
        <div className="receipt-row">
          <span className="receipt-k">Fecha</span>
          <span className="receipt-v">{formatLocalDate(t.startsAt.slice(0, 10))}</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-k">Horario</span>
          <span className="receipt-v">{formatMinute(start.getHours() * 60 + start.getMinutes())} hs</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-k">Formato</span>
          <span className="receipt-v">{FORMAT_LABEL[t.format] ?? t.format}</span>
        </div>
        {t.category && (
          <div className="receipt-row">
            <span className="receipt-k">Categoría</span>
            <span className="receipt-v">{t.category}</span>
          </div>
        )}
        <div className="receipt-row">
          <span className="receipt-k">Inscripción</span>
          <span className="receipt-v">{t.entryFee > 0 ? formatMoney(t.entryFee) : 'Gratis'}</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-k">Lugares</span>
          <span className="receipt-v">{t.spotsLeft} libres</span>
        </div>
        {t.prizeDescription && (
          <div className="receipt-row">
            <span className="receipt-k">Premio</span>
            <span className="receipt-v">{t.prizeDescription}</span>
          </div>
        )}
      </section>

      {t.teams.length > 0 && (
        <section className="card">
          <div className="player-section-title" style={{ marginTop: 0 }}>
            Equipos anotados ({t.teams.length})
          </div>
          <div className="booking-list">
            {t.teams.map((team) => (
              <div className="booking-item" key={team.id}>
                <span className="booking-item-dot" style={{ background: 'var(--ds-primary, #c8443e)' }} />
                <div className="booking-item-main">
                  <span className="booking-item-court">{team.name}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!t.registrationOpen && (
        <div className="info-banner">La inscripción para este torneo está cerrada.</div>
      )}

      {t.registrationOpen && !showForm && (
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          Anotar mi equipo
        </button>
      )}

      {t.registrationOpen && showForm && (
        <section className="booking-form">
          <div className="field">
            <label className="label" htmlFor="team-name">Nombre del equipo</label>
            <input
              id="team-name"
              className="input"
              value={teamName}
              disabled={submitting}
              onChange={(e) => { setTeamName(e.target.value); setFormError(null); }}
              placeholder="Ej: Los Zurdos"
            />
          </div>

          <div className="team-form-players">
            {players.map((p, i) => (
              <div className="team-player-block" key={i}>
                <div className="team-player-block-head">
                  <span>Jugador {i + 1}</span>
                  {players.length > 1 && (
                    <button
                      type="button"
                      className="player-link-btn"
                      disabled={submitting}
                      onClick={() => setPlayers((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      Quitar
                    </button>
                  )}
                </div>
                <input
                  className="input"
                  placeholder="Nombre"
                  value={p.firstName}
                  disabled={submitting}
                  onChange={(e) => updatePlayer(i, { firstName: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Apellido (opcional)"
                  value={p.lastName}
                  disabled={submitting}
                  onChange={(e) => updatePlayer(i, { lastName: e.target.value })}
                />
                <input
                  className="input"
                  type="tel"
                  inputMode="tel"
                  placeholder="Teléfono"
                  value={p.phone}
                  disabled={submitting}
                  onChange={(e) => updatePlayer(i, { phone: e.target.value })}
                />
              </div>
            ))}
          </div>

          {players.length < MAX_PLAYERS && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={submitting}
              onClick={() => setPlayers((prev) => [...prev, emptyPlayer()])}
            >
              + Agregar jugador
            </button>
          )}

          {formError && <div className="alert">{formError}</div>}

          <div className="sticky-cta">
            <div className="sticky-cta-inner">
              <button className="btn btn-primary" disabled={submitting} onClick={() => void submit()}>
                {submitting ? <span className="spinner" /> : 'Confirmar inscripción'}
              </button>
            </div>
          </div>
        </section>
      )}

      <a className="player-nav-link" href={`/c/${slug}/torneos`}>← Ver otros torneos</a>
    </>
  );
}
