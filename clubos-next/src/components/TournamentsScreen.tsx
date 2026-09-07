'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/grid';
import { useSession, useToasts } from '@/hooks';
import { Toasts } from '@/components/Toasts';

/**
 * Torneos.
 *
 * ---------------------------------------------------------------------------
 * DOS VISTAS SEGÚN EL FORMATO
 * ---------------------------------------------------------------------------
 * Un cuadro de eliminación y una tabla de posiciones responden preguntas
 * distintas. Eliminación: "¿contra quién juego ahora?". Todos contra todos:
 * "¿cómo vengo?".
 *
 * La pantalla muestra la que corresponde al formato en vez de las dos, para
 * no obligar a elegir en una pantalla que se mira entre partidos.
 * ---------------------------------------------------------------------------
 */

interface TournamentRow {
  id: string; name: string; format: string; category: string | null;
  startsAt: string; status: string; maxTeams: number; entryFee: number;
  registeredTeams: number; spotsLeft: number;
}

const FORMAT_LABEL: Record<string, string> = {
  ELIMINATION: 'Eliminación directa',
  DOUBLE_ELIMINATION: 'Doble eliminación',
  ROUND_ROBIN: 'Todos contra todos',
  GROUPS_PLAYOFF: 'Grupos + playoff',
  AMERICANO: 'Americano',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  REGISTRATION_OPEN: 'Inscripción abierta',
  REGISTRATION_CLOSED: 'Inscripción cerrada',
  IN_PROGRESS: 'En juego',
  FINISHED: 'Terminado',
  CANCELLED: 'Cancelado',
};

/** Los formatos de tabla; el resto se dibuja como cuadro. */
const TABLE_FORMATS = ['ROUND_ROBIN', 'GROUPS_PLAYOFF', 'AMERICANO'];

export function TournamentsScreen() {
  const { can, isDemo } = useSession();
  const canOrDemo = useCallback(
    (permission: string) => isDemo || can(permission),
    [isDemo, can],
  );
  const { toasts, show, dismiss } = useToasts();

  const [list, setList] = useState<TournamentRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.tournaments.list();
      setList(res);
      setDemo(false);
      // Con un solo torneo activo, abrirlo directo ahorra un clic.
      const active = res.find((t) => t.status === 'IN_PROGRESS');
      if (active && !selectedId) setSelectedId(active.id);
    } catch {
      setDemo(true);
    } finally {
      setLoading(false);
    }
    // selectedId a propósito fuera: recargar no debe cambiar la selección.
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (demo) {
    return (
      <div className="screen-empty">
        <h1>Torneos</h1>
        <p>Esta pantalla necesita el backend para funcionar.</p>
        <p className="muted">
          Inscribí parejas, sorteá el cuadro y cargá resultados.
        </p>
      </div>
    );
  }

  if (selectedId) {
    return (
      <>
        <TournamentDetail
          tournamentId={selectedId}
          can={canOrDemo}
          onBack={() => { setSelectedId(null); void load(); }}
          onMessage={show}
        />
        <Toasts toasts={toasts} onDismiss={dismiss} />
      </>
    );
  }

  return (
    <div className="tournaments-screen">
      <header className="screen-head">
        <div>
          <h1 className="screen-title">Torneos</h1>
          <p className="screen-sub">{list.length} torneo{list.length === 1 ? '' : 's'}</p>
        </div>
      </header>

      {loading ? (
        <p className="card-empty">Cargando…</p>
      ) : list.length === 0 ? (
        <div className="screen-empty">
          <p>Todavía no hay torneos.</p>
          <p className="muted">
            Creá uno desde la configuración del club para empezar a inscribir parejas.
          </p>
        </div>
      ) : (
        <div className="tournament-list">
          {list.map((t) => (
            <button className="tournament-card" key={t.id}
                    onClick={() => setSelectedId(t.id)}>
              <div className="tournament-head">
                <span className="tournament-name">{t.name}</span>
                <span className={`status-pill is-${t.status.toLowerCase()}`}>
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </div>
              <div className="tournament-meta">
                <span>{FORMAT_LABEL[t.format] ?? t.format}</span>
                {t.category && <span>· {t.category}</span>}
                <span>
                  · {new Date(t.startsAt).toLocaleDateString('es-AR', {
                    day: 'numeric', month: 'long',
                  })}
                </span>
              </div>
              <div className="tournament-foot">
                <span className="teams-count">
                  {t.registeredTeams} de {t.maxTeams} parejas
                </span>
                {t.entryFee > 0 && (
                  <span className="cell-muted">
                    Inscripción {formatMoney(t.entryFee)}
                  </span>
                )}
              </div>
              <div className="progress-bar">
                <span style={{
                  width: `${Math.min(100, (t.registeredTeams / t.maxTeams) * 100)}%`,
                }} />
              </div>
            </button>
          ))}
        </div>
      )}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

/** Detalle: cuadro o tabla según el formato. */
function TournamentDetail({
  tournamentId, can, onBack, onMessage,
}: {
  tournamentId: string;
  can: (p: string) => boolean;
  onBack: () => void;
  onMessage: (m: string, kind?: 'ok' | 'error') => void;
}) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.tournaments.detail>> | null>(null);
  const [fixture, setFixture] = useState<Awaited<ReturnType<typeof api.tournaments.fixture>>>([]);
  const [standings, setStandings] = useState<Awaited<ReturnType<typeof api.tournaments.standings>>>([]);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.tournaments.detail(tournamentId);
      setDetail(d);
      const [f, s] = await Promise.all([
        api.tournaments.fixture(tournamentId),
        api.tournaments.standings(tournamentId),
      ]);
      setFixture(f);
      setStandings(s);
    } catch (e) {
      onMessage(e instanceof Error ? e.message : 'No se pudo cargar el torneo.', 'error');
    } finally {
      setLoading(false);
    }
  }, [tournamentId, onMessage]);

  useEffect(() => { void load(); }, [load]);

  if (loading || !detail) return <p className="card-empty">Cargando…</p>;

  const isTable = TABLE_FORMATS.includes(detail.format);
  const hasFixture = fixture.length > 0;

  return (
    <div className="tournament-detail">
      <header className="screen-head">
        <div>
          <button className="back-link" onClick={onBack}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Torneos
          </button>
          <h1 className="screen-title">{detail.name}</h1>
          <p className="screen-sub">
            {FORMAT_LABEL[detail.format] ?? detail.format} ·{' '}
            {detail.teams.length} parejas
            {detail.entryFee > 0 && ` · inscripción ${formatMoney(detail.entryFee)}`}
          </p>
        </div>

        {!hasFixture && can('tournament.manage') && detail.teams.length >= 2 && (
          <div className="screen-actions">
            <button
              className="btn btn-primary"
              onClick={async () => {
                try {
                  const res = await api.tournaments.generateFixture(tournamentId);
                  await load();
                  onMessage(
                    `Cuadro sorteado: ${res.generated} partidos en ${res.rounds} rondas` +
                    (res.byes > 0 ? `, ${res.byes} pasan sin jugar.` : '.'),
                  );
                } catch (e) {
                  onMessage(
                    e instanceof Error ? e.message : 'No se pudo sortear.', 'error',
                  );
                }
              }}
            >
              Sortear cuadro
            </button>
          </div>
        )}
      </header>

      {!hasFixture ? (
        <div className="panel-card">
          <h2 className="card-title">Parejas inscriptas</h2>
          {detail.teams.length === 0 ? (
            <p className="card-empty">Todavía no hay parejas inscriptas.</p>
          ) : (
            <>
              <div className="team-grid">
                {detail.teams.map((t) => (
                  <div className="team-chip" key={t.id}>
                    <span className="team-seed">{t.seed ?? '—'}</span>
                    <div>
                      <div className="team-name">{t.name}</div>
                      <div className="cell-muted">
                        {t.members.map((m) => `${m.firstName} ${m.lastName}`).join(' · ')}
                      </div>
                    </div>
                    {t.paymentStatus !== 'PAID' && (
                      <span className="tag-danger">Falta pagar</span>
                    )}
                  </div>
                ))}
              </div>
              {detail.teams.length < 2 && (
                <p className="field-hint">
                  Hacen falta al menos dos parejas para sortear.
                </p>
              )}
            </>
          )}
        </div>
      ) : isTable ? (
        <StandingsView standings={standings} />
      ) : (
        <BracketView
          fixture={fixture}
          canScore={can('tournament.manage')}
          scoring={scoring}
          onScore={setScoring}
          onSaved={async (msg) => { setScoring(null); await load(); onMessage(msg); }}
          onError={(m) => onMessage(m, 'error')}
        />
      )}

      {hasFixture && isTable && (
        <MatchList
          fixture={fixture}
          canScore={can('tournament.manage')}
          scoring={scoring}
          onScore={setScoring}
          onSaved={async (msg) => { setScoring(null); await load(); onMessage(msg); }}
          onError={(m) => onMessage(m, 'error')}
        />
      )}
    </div>
  );
}

/** Cuadro: una columna por ronda. */
function BracketView({
  fixture, canScore, scoring, onScore, onSaved, onError,
}: {
  fixture: Awaited<ReturnType<typeof api.tournaments.fixture>>;
  canScore: boolean;
  scoring: string | null;
  onScore: (id: string | null) => void;
  onSaved: (msg: string) => Promise<void>;
  onError: (m: string) => void;
}) {
  return (
    <div className="bracket">
      {fixture.map((round) => (
        <div className="bracket-round" key={round.round}>
          <h3 className="round-title">{round.round}</h3>
          <div className="bracket-matches">
            {round.matches.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                canScore={canScore}
                isScoring={scoring === m.id}
                onScore={onScore}
                onSaved={onSaved}
                onError={onError}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Tabla de posiciones, una por grupo. */
function StandingsView({
  standings,
}: {
  standings: Awaited<ReturnType<typeof api.tournaments.standings>>;
}) {
  return (
    <div className="standings-stack">
      {standings.map((group) => (
        <section className="panel-card" key={group.group ?? 'general'}>
          <h2 className="card-title">
            {group.group ? `Grupo ${group.group}` : 'Posiciones'}
          </h2>
          <table className="data-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Pareja</th>
                <th className="num">PJ</th>
                <th className="num">G</th>
                <th className="num">P</th>
                <th className="num" title="Diferencia de sets">Sets</th>
                <th className="num" title="Diferencia de games">Games</th>
                <th className="num">Pts</th>
              </tr>
            </thead>
            <tbody>
              {group.standings.map((r) => (
                <tr key={r.teamId} className={r.position <= 2 ? 'is-qualified' : ''}>
                  <td className="num strong">{r.position}</td>
                  <td>{r.name}</td>
                  <td className="num">{r.played}</td>
                  <td className="num">{r.won}</td>
                  <td className="num">{r.lost}</td>
                  <td className="num cell-muted">
                    {signed(r.setsWon - r.setsLost)}
                  </td>
                  <td className="num cell-muted">
                    {signed(r.gamesWon - r.gamesLost)}
                  </td>
                  <td className="num strong">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

/** Lista de partidos para formatos de tabla. */
function MatchList({
  fixture, canScore, scoring, onScore, onSaved, onError,
}: {
  fixture: Awaited<ReturnType<typeof api.tournaments.fixture>>;
  canScore: boolean;
  scoring: string | null;
  onScore: (id: string | null) => void;
  onSaved: (msg: string) => Promise<void>;
  onError: (m: string) => void;
}) {
  const pending = fixture.flatMap((r) =>
    r.matches.filter((m) => m.status === 'SCHEDULED'),
  );

  if (pending.length === 0) return null;

  return (
    <section className="panel-card" style={{ marginTop: 'var(--sp-4)' }}>
      <h2 className="card-title">Partidos por jugar</h2>
      <div className="match-list">
        {pending.slice(0, 12).map((m) => (
          <MatchCard
            key={m.id}
            match={m}
            canScore={canScore}
            isScoring={scoring === m.id}
            onScore={onScore}
            onSaved={onSaved}
            onError={onError}
            compact
          />
        ))}
      </div>
    </section>
  );
}

type Match = Awaited<ReturnType<typeof api.tournaments.fixture>>[number]['matches'][number];

function MatchCard({
  match, canScore, isScoring, onScore, onSaved, onError, compact,
}: {
  match: Match;
  canScore: boolean;
  isScoring: boolean;
  onScore: (id: string | null) => void;
  onSaved: (msg: string) => Promise<void>;
  onError: (m: string) => void;
  compact?: boolean;
}) {
  const played = match.status === 'FINISHED' || match.status === 'WALKOVER';
  const ready = match.homeTeam && match.awayTeam;

  if (isScoring && match.homeTeam && match.awayTeam) {
    return (
      <ScoreForm
        match={match}
        onCancel={() => onScore(null)}
        onSaved={onSaved}
        onError={onError}
      />
    );
  }

  return (
    <div className={`match-card${compact ? ' is-compact' : ''}${played ? ' is-played' : ''}`}>
      <TeamLine
        name={match.homeTeam?.name ?? 'A definir'}
        sets={match.scoreSets?.map((s) => s[0])}
        isWinner={match.winnerTeamId === match.homeTeam?.id}
        pending={!match.homeTeam}
      />
      <TeamLine
        name={match.awayTeam?.name ?? 'A definir'}
        sets={match.scoreSets?.map((s) => s[1])}
        isWinner={match.winnerTeamId === match.awayTeam?.id}
        pending={!match.awayTeam}
      />
      {!played && ready && canScore && (
        <button className="btn-mini match-score-btn" onClick={() => onScore(match.id)}>
          Cargar resultado
        </button>
      )}
      {match.status === 'WALKOVER' && !match.scoreSets && (
        <span className="match-note">Pasó sin jugar</span>
      )}
    </div>
  );
}

function TeamLine({ name, sets, isWinner, pending }: {
  name: string; sets?: number[]; isWinner?: boolean; pending?: boolean;
}) {
  return (
    <div className={`team-line${isWinner ? ' is-winner' : ''}${pending ? ' is-pending' : ''}`}>
      <span className="team-line-name">{name}</span>
      {sets && (
        <span className="team-line-sets">
          {sets.map((g, i) => <span key={i}>{g}</span>)}
        </span>
      )}
    </div>
  );
}

/**
 * Carga de resultado.
 *
 * El backend valida que el marcador sea posible en pádel: 6-5 o 9-3 no
 * existen. La pantalla no duplica esa validación — la deja fallar y muestra
 * el mensaje, que es más claro que dos reglas que pueden desincronizarse.
 */
function ScoreForm({
  match, onCancel, onSaved, onError,
}: {
  match: Match;
  onCancel: () => void;
  onSaved: (msg: string) => Promise<void>;
  onError: (m: string) => void;
}) {
  const [sets, setSets] = useState<Array<[string, string]>>([['', ''], ['', '']]);
  const [busy, setBusy] = useState(false);

  const update = (i: number, side: 0 | 1, value: string) => {
    setSets((prev) => prev.map((s, idx) => {
      if (idx !== i) return s;
      const next: [string, string] = [...s];
      next[side] = value;
      return next;
    }));
  };

  const submit = async () => {
    const parsed = sets
      .filter(([h, a]) => h !== '' && a !== '')
      .map(([h, a]) => [Number(h), Number(a)] as [number, number]);

    if (parsed.length === 0) {
      onError('Cargá al menos un set.');
      return;
    }

    setBusy(true);
    try {
      await api.tournaments.recordResult(match.id, { scoreSets: parsed });
      await onSaved('Resultado cargado.');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo cargar el resultado.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="match-card is-scoring">
      <div className="score-grid">
        <span className="score-team">{match.homeTeam?.name}</span>
        {sets.map((s, i) => (
          <input
            key={`h${i}`}
            className="score-input"
            type="number"
            inputMode="numeric"
            min={0}
            max={7}
            value={s[0]}
            autoFocus={i === 0}
            onChange={(e) => update(i, 0, e.target.value)}
          />
        ))}

        <span className="score-team">{match.awayTeam?.name}</span>
        {sets.map((s, i) => (
          <input
            key={`a${i}`}
            className="score-input"
            type="number"
            inputMode="numeric"
            min={0}
            max={7}
            value={s[1]}
            onChange={(e) => update(i, 1, e.target.value)}
          />
        ))}
      </div>

      {sets.length < 3 && (
        <button
          className="link-btn"
          onClick={() => setSets((p) => [...p, ['', '']])}
        >
          Agregar tercer set
        </button>
      )}

      <div className="score-actions">
        <button className="btn-mini" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button className="btn-mini is-primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
