'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/grid';

/**
 * Ficha del cliente.
 *
 * ---------------------------------------------------------------------------
 * QUÉ SE MIRA PRIMERO
 * ---------------------------------------------------------------------------
 * Cuando recepción abre una ficha con el cliente parado enfrente, lo que
 * necesita saber en dos segundos es: ¿debe plata? ¿cuándo vino por última
 * vez? ¿tiene turno hoy?
 *
 * Todo lo demás — nivel, mano hábil, dirección — importa para el CRM pero no
 * para el mostrador. Por eso el saldo y los próximos turnos van arriba, y el
 * resto abajo.
 * ---------------------------------------------------------------------------
 */

interface Profile {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  documentNumber: string | null;
  birthDate: string | null;
  status: string;
  clientSince: string;
  skillLevel: string | null;
  dominantHand: string | null;
  preferredSide: string | null;
  accountBalance: number;
  creditLimit: number;
  availableCredit: number;
  totalSpent?: number;
  bookingsCount: number;
  cancellationsCount: number;
  noShowCount: number;
  lastVisitAt: string | null;
  tags: Array<{ code: string; name: string; color: string }>;
  stats: {
    totalBookings: number;
    cancellations: number;
    noShows: number;
    cancellationRate: number;
    noShowRate: number;
    averageTicket: number;
    daysSinceLastVisit: number | null;
  };
  upcomingBookings: Array<{
    id: string; code: string; startsAt: string; status: string;
    totalPrice: number; paidAmount: number;
    court: { name: string; color: string };
  }>;
  recentBookings: Array<{
    id: string; code: string; startsAt: string; status: string;
    totalPrice: number; court: { name: string };
  }>;
}

const SKILL_LABEL: Record<string, string> = {
  BEGINNER: 'Principiante', INTERMEDIATE: 'Intermedio',
  ADVANCED: 'Avanzado', PROFESSIONAL: 'Profesional',
};
const HAND_LABEL: Record<string, string> = {
  RIGHT: 'Diestro', LEFT: 'Zurdo', AMBIDEXTROUS: 'Ambidiestro',
};
const SIDE_LABEL: Record<string, string> = {
  DRIVE: 'Drive', REVES: 'Revés', BOTH: 'Ambos',
};
const STATUS_LABEL: Record<string, string> = {
  COMPLETED: 'Jugado', CONFIRMED: 'Confirmado', PAID: 'Pagado',
  PENDING: 'Pendiente', IN_PROGRESS: 'En curso',
  CANCELLED_BY_CLIENT: 'Canceló', CANCELLED_BY_CLUB: 'Cancelado por el club',
  NO_SHOW: 'No vino',
};

export function ClientProfile({
  clientId, onClose, onError,
}: {
  clientId: string;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const p = await api.clients.profile(clientId);
        if (!cancelled) setProfile(p as unknown as Profile);
      } catch (e) {
        if (!cancelled) {
          onError(e instanceof Error ? e.message : 'No se pudo cargar la ficha.');
          onClose();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, onClose, onError]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" aria-label="Ficha del cliente">
        {loading || !profile ? (
          <div className="drawer-loading">Cargando…</div>
        ) : (
          <>
            <header className="drawer-head">
              <div className="drawer-title">
                <span className="avatar is-large">
                  {(profile.firstName[0] ?? '') + (profile.lastName[0] ?? '')}
                </span>
                <div>
                  <h2 className="drawer-name">
                    {profile.firstName} {profile.lastName}
                  </h2>
                  <p className="drawer-meta">
                    Cliente desde{' '}
                    {new Date(profile.clientSince).toLocaleDateString('es-AR', {
                      month: 'long', year: 'numeric',
                    })}
                  </p>
                  {profile.tags.length > 0 && (
                    <div className="cell-tags">
                      {profile.tags.map((t) => (
                        <span key={t.code} className="tag-color"
                              style={{ ['--tag' as string]: t.color }}>
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </header>

            <div className="drawer-body">
              {/* Lo primero: ¿debe plata? */}
              {profile.accountBalance !== 0 && (
                <div className={`account-box${profile.accountBalance < 0 ? ' is-owed' : ''}`}>
                  <span className="account-label">
                    {profile.accountBalance < 0 ? 'Debe' : 'Saldo a favor'}
                  </span>
                  <span className="account-value">
                    {formatMoney(Math.abs(profile.accountBalance))}
                  </span>
                  {profile.creditLimit > 0 && profile.accountBalance < 0 && (
                    <span className="account-hint">
                      Crédito disponible: {formatMoney(profile.availableCredit)}
                    </span>
                  )}
                </div>
              )}

              {profile.upcomingBookings.length > 0 && (
                <section className="drawer-section">
                  <h3 className="section-title">Próximos turnos</h3>
                  <div className="booking-list">
                    {profile.upcomingBookings.map((b) => (
                      <div className="booking-row" key={b.id}>
                        <span className="booking-court"
                              style={{ ['--court' as string]: b.court.color }}>
                          {b.court.name}
                        </span>
                        <span className="booking-when">
                          {new Date(b.startsAt).toLocaleString('es-AR', {
                            weekday: 'short', day: 'numeric', month: 'short',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                        {b.totalPrice > b.paidAmount && (
                          <span className="balance-owed">
                            Falta {formatMoney(b.totalPrice - b.paidAmount)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="drawer-section">
                <h3 className="section-title">Contacto</h3>
                <dl className="field-group">
                  <Field label="Teléfono" value={profile.phone ?? '—'} />
                  <Field label="Email" value={profile.email ?? '—'} />
                  <Field label="Documento" value={profile.documentNumber ?? '—'} />
                  <Field
                    label="Última visita"
                    value={
                      profile.stats.daysSinceLastVisit === null
                        ? 'Nunca vino'
                        : profile.stats.daysSinceLastVisit === 0
                          ? 'Hoy'
                          : `Hace ${profile.stats.daysSinceLastVisit} días`
                    }
                  />
                </dl>
              </section>

              <section className="drawer-section">
                <h3 className="section-title">Actividad</h3>
                <div className="stat-grid">
                  <StatBox label="Turnos" value={String(profile.stats.totalBookings)} />
                  {profile.totalSpent !== undefined && (
                    <StatBox label="Gastado" value={formatMoney(profile.totalSpent)} />
                  )}
                  {profile.stats.averageTicket > 0 && (
                    <StatBox label="Ticket promedio"
                             value={formatMoney(profile.stats.averageTicket)} />
                  )}
                  <StatBox
                    label="Canceló"
                    value={`${profile.stats.cancellations} (${profile.stats.cancellationRate}%)`}
                    warn={profile.stats.cancellationRate > 25}
                  />
                  {profile.stats.noShows > 0 && (
                    <StatBox
                      label="No vino"
                      value={`${profile.stats.noShows} (${profile.stats.noShowRate}%)`}
                      warn={profile.stats.noShowRate > 10}
                    />
                  )}
                </div>
              </section>

              {(profile.skillLevel || profile.dominantHand || profile.preferredSide) && (
                <section className="drawer-section">
                  <h3 className="section-title">Juego</h3>
                  <dl className="field-group">
                    {profile.skillLevel && (
                      <Field label="Nivel"
                             value={SKILL_LABEL[profile.skillLevel] ?? profile.skillLevel} />
                    )}
                    {profile.dominantHand && (
                      <Field label="Mano"
                             value={HAND_LABEL[profile.dominantHand] ?? profile.dominantHand} />
                    )}
                    {profile.preferredSide && (
                      <Field label="Posición"
                             value={SIDE_LABEL[profile.preferredSide] ?? profile.preferredSide} />
                    )}
                  </dl>
                </section>
              )}

              {profile.recentBookings.length > 0 && (
                <section className="drawer-section">
                  <h3 className="section-title">Últimos turnos</h3>
                  <div className="booking-list">
                    {profile.recentBookings.slice(0, 8).map((b) => (
                      <div className="booking-row is-past" key={b.id}>
                        <span className="booking-when">
                          {new Date(b.startsAt).toLocaleDateString('es-AR', {
                            day: 'numeric', month: 'short',
                          })}
                        </span>
                        <span className="cell-muted">{b.court.name}</span>
                        <span className={
                          b.status === 'NO_SHOW' || b.status.startsWith('CANCELLED')
                            ? 'status-off' : 'cell-muted'
                        }>
                          {STATUS_LABEL[b.status] ?? b.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <dt className="field-label">{label}</dt>
      <dd className="field-value">{value}</dd>
    </div>
  );
}

function StatBox({ label, value, warn }: {
  label: string; value: string; warn?: boolean;
}) {
  return (
    <div className="stat-box">
      <span className="stat-box-label">{label}</span>
      <span className={`stat-box-value${warn ? ' is-warn' : ''}`}>{value}</span>
    </div>
  );
}
