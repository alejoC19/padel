'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/grid';
import { useSession } from '@/hooks';

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
const CLIENT_STATUS_LABEL: Record<string, string> = {
  INACTIVE: 'Inactivo', SUSPENDED: 'Suspendido', BLACKLISTED: 'Bloqueado',
};

export function ClientProfile({
  clientId, onClose, onError,
}: {
  clientId: string;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const { can, isDemo } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    // En modo demo no hay backend al que pedirle la ficha completa (turnos,
    // pagos, estadísticas) — antes esto igual intentaba el fetch, fallaba,
    // y cerraba el drawer con un toast de error genérico, como si la ficha
    // de un cliente de ejemplo fuera un error real. Se avisa en vez de
    // fallar, mismo criterio que ya usan Caja y Tesorería sin sesión.
    if (isDemo) { setLoading(false); return; }

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
  }, [clientId, isDemo, onClose, onError]);

  const reload = async () => {
    try {
      const p = await api.clients.profile(clientId);
      setProfile(p as unknown as Profile);
    } catch {
      // Si la recarga falla la ficha se queda con los datos previos —
      // el guardado ya se confirmó, esto es solo refrescar la vista.
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" aria-label="Ficha del cliente">
        {isDemo ? (
          <>
            <header className="drawer-head">
              <span className="drawer-title">Ficha del cliente</span>
              <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </header>
            <div className="drawer-loading">
              La ficha completa (turnos, pagos, historial) necesita el backend para funcionar.
            </div>
          </>
        ) : loading || !profile ? (
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
                    {CLIENT_STATUS_LABEL[profile.status] && (
                      <span className={`tag ${profile.status === 'INACTIVE' ? 'warning' : 'danger'}`}>
                        {CLIENT_STATUS_LABEL[profile.status]}
                      </span>
                    )}
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
              <div className="drawer-head-actions">
                {can('client.update') && (
                  <button className="icon-btn" onClick={() => setEditOpen(true)}
                          aria-label="Editar ficha" title="Editar ficha">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="2">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                )}
                <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
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

      {editOpen && profile && (
        <EditClientDialog
          profile={profile}
          onClose={() => setEditOpen(false)}
          onSaved={async () => {
            setEditOpen(false);
            await reload();
          }}
          onError={onError}
        />
      )}
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

/**
 * Editar ficha.
 *
 * Mismos campos que ya muestra la ficha (Contacto + Juego), ni uno más:
 * el backend acepta bastante más (dirección, descuento, límite de
 * crédito, lista de precios…) pero nada de eso se ve hoy en el perfil, y
 * editar un dato que la propia ficha no muestra es más confuso que útil.
 */
function EditClientDialog({
  profile, onClose, onSaved, onError,
}: {
  profile: Profile;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [email, setEmail] = useState(profile.email ?? '');
  const [documentNumber, setDocumentNumber] = useState(profile.documentNumber ?? '');
  const [skillLevel, setSkillLevel] = useState(profile.skillLevel ?? '');
  const [dominantHand, setDominantHand] = useState(profile.dominantHand ?? '');
  const [preferredSide, setPreferredSide] = useState(profile.preferredSide ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (firstName.trim().length < 2 || lastName.trim().length < 2) {
      onError('Completá nombre y apellido.');
      return;
    }
    setBusy(true);
    try {
      await api.clients.update(profile.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        documentNumber: documentNumber.trim() || undefined,
        skillLevel: skillLevel || undefined,
        dominantHand: dominantHand || undefined,
        preferredSide: preferredSide || undefined,
      });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo guardar la ficha.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Editar cliente">
        <h2 className="dialog-title">Editar ficha</h2>

        <h3 className="section-title">Identidad</h3>
        <div className="field-pair">
          <label className="field-block">
            <span className="label">Nombre</span>
            <input className="input" value={firstName} autoFocus
                   onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="field-block">
            <span className="label">Apellido</span>
            <input className="input" value={lastName}
                   onChange={(e) => setLastName(e.target.value)} />
          </label>
        </div>

        <h3 className="section-title">Contacto</h3>
        <div className="field-pair">
          <label className="field-block">
            <span className="label">Teléfono</span>
            <input className="input" value={phone} inputMode="tel"
                   placeholder="11 4567-8900"
                   onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="field-block">
            <span className="label">Email</span>
            <input className="input" type="email" value={email}
                   onChange={(e) => setEmail(e.target.value)} />
          </label>
        </div>
        <label className="field-block">
          <span className="label">Documento</span>
          <input className="input" value={documentNumber} inputMode="numeric"
                 onChange={(e) => setDocumentNumber(e.target.value)} />
        </label>

        <h3 className="section-title">Juego</h3>
        <div className="field-pair">
          <label className="field-block">
            <span className="label">Nivel</span>
            <select className="input" value={skillLevel}
                    onChange={(e) => setSkillLevel(e.target.value)}>
              <option value="">Sin definir</option>
              {Object.entries(SKILL_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className="field-block">
            <span className="label">Mano</span>
            <select className="input" value={dominantHand}
                    onChange={(e) => setDominantHand(e.target.value)}>
              <option value="">Sin definir</option>
              {Object.entries(HAND_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="field-block">
          <span className="label">Posición</span>
          <select className="input" value={preferredSide}
                  onChange={(e) => setPreferredSide(e.target.value)}>
            <option value="">Sin definir</option>
            {Object.entries(SIDE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}
