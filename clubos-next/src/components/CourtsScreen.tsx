'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/grid';
import { useSession, useToasts } from '@/hooks';
import { Toasts } from '@/components/Toasts';

/**
 * Canchas del club.
 *
 * El onboarding crea UNA cancha ("Cancha 1") solo para que la agenda no
 * arranque vacía — un club real tiene más de una, y hasta este componente
 * no existía forma de agregarlas: el backend (CourtService) tenía el CRUD
 * completo desde antes, pero nada en el panel lo llamaba.
 */

interface Court {
  id: string; sportId: string; name: string; number: number;
  environment: string; surface: string; hasLighting: boolean;
  capacity: number | null; color: string; status: string;
  slotMinutes: number; features: string[]; sortOrder: number;
}

const ENVIRONMENT_LABEL: Record<string, string> = {
  INDOOR: 'Cubierta', OUTDOOR: 'Descubierta', COVERED: 'Semicubierta',
};
const SURFACE_LABEL: Record<string, string> = {
  SYNTHETIC_GRASS: 'Césped sintético', CONCRETE: 'Cemento',
  CLAY: 'Polvo de ladrillo', CRYSTAL: 'Cristal', OTHER: 'Otra',
};
const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'Disponible', MAINTENANCE: 'En mantenimiento', DISABLED: 'Dada de baja',
};

interface PriceRule {
  id: string;
  courtId: string | null;
  court: { id: string; name: string } | null;
  dayOfWeek: number | null;
  fromMinute: number | null;
  toMinute: number | null;
  durationMinutes: number | null;
  bookingType: string | null;
  price: number;
  priority: number;
  isActive: boolean;
}

const DAY_LABEL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const BOOKING_TYPE_LABEL: Record<string, string> = {
  REGULAR: 'Turno normal', LESSON: 'Clase', TOURNAMENT: 'Torneo', EVENT: 'Evento',
};

function minuteToTime(m: number | null): string {
  if (m === null || m === undefined) return '';
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const mm = (m % 60).toString().padStart(2, '0');
  return `${h}:${mm}`;
}
function timeToMinute(t: string): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function CourtsScreen() {
  const { can } = useSession();
  const { toasts, show, dismiss } = useToasts();
  const canManage = can('court.manage');
  const canViewPrices = can('price.view');
  const canManagePrices = can('price.manage');

  const [courts, setCourts] = useState<Court[]>([]);
  const [rules, setRules] = useState<PriceRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rulesError, setRulesError] = useState(false);
  const [formOpen, setFormOpen] = useState<'new' | Court | null>(null);
  const [ruleFormOpen, setRuleFormOpen] = useState<'new' | PriceRule | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCourts(await api.courts.list());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
    if (canViewPrices) {
      try {
        setRules(await api.priceRules.list());
        setRulesError(false);
      } catch {
        setRulesError(true);
      }
    }
  }, [canViewPrices]);

  useEffect(() => { void load(); }, [load]);

  const toggleMaintenance = useCallback(async (court: Court) => {
    const next = court.status === 'AVAILABLE' ? 'MAINTENANCE' : 'AVAILABLE';
    setBusyId(court.id);
    try {
      await api.courts.update(court.id, { status: next });
      show(next === 'MAINTENANCE' ? 'En mantenimiento.' : 'Disponible de nuevo.');
      await load();
    } catch (e) {
      show(e instanceof ApiError ? e.message : 'No pudimos actualizar la cancha.', 'error');
    } finally {
      setBusyId(null);
    }
  }, [load, show]);

  const remove = useCallback(async (court: Court) => {
    if (!confirm(`¿Dar de baja "${court.name}"?`)) return;
    setBusyId(court.id);
    try {
      await api.courts.remove(court.id);
      show('Cancha dada de baja.');
      await load();
    } catch (e) {
      show(e instanceof ApiError ? e.message : 'No pudimos darla de baja.', 'error');
    } finally {
      setBusyId(null);
    }
  }, [load, show]);

  const removeRule = useCallback(async (rule: PriceRule) => {
    if (!confirm('¿Borrar esta regla de precio?')) return;
    setBusyRuleId(rule.id);
    try {
      await api.priceRules.remove(rule.id);
      show('Regla de precio borrada.');
      await load();
    } catch (e) {
      show(e instanceof ApiError ? e.message : 'No pudimos borrar la regla.', 'error');
    } finally {
      setBusyRuleId(null);
    }
  }, [load, show]);

  return (
    <div className="team-screen">
      <Toasts toasts={toasts} onDismiss={dismiss} />

      <header className="screen-head">
        <div>
          <h1 className="screen-title">Canchas</h1>
          <p className="screen-sub">
            {courts.length} cancha{courts.length === 1 ? '' : 's'}
          </p>
        </div>
        {canManage && (
          <div className="screen-actions">
            <button className="btn btn-primary" onClick={() => setFormOpen('new')}>
              Nueva cancha
            </button>
          </div>
        )}
      </header>

      {loading ? (
        <p className="card-empty">Cargando…</p>
      ) : error ? (
        <div className="screen-empty">
          <p>No pudimos cargar las canchas.</p>
        </div>
      ) : courts.length === 0 ? (
        <div className="screen-empty">
          <p>Todavía no hay canchas cargadas.</p>
        </div>
      ) : (
        <div className="panel-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Cancha</th>
                <th>Ambiente</th>
                <th>Superficie</th>
                <th>Estado</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {courts.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="cell-main">
                      <span className="team-seed" style={{ color: c.color }}>●</span>{' '}
                      {c.name}
                      {c.hasLighting && <span className="cell-muted"> · con luz</span>}
                    </div>
                  </td>
                  <td className="cell-muted">{ENVIRONMENT_LABEL[c.environment] ?? c.environment}</td>
                  <td className="cell-muted">{SURFACE_LABEL[c.surface] ?? c.surface}</td>
                  <td>
                    <span className={`status-pill ${
                      c.status === 'AVAILABLE' ? 'success'
                        : c.status === 'MAINTENANCE' ? 'warning' : 'danger'
                    }`}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </td>
                  {canManage && (
                    <td className="cell-actions">
                      <button className="btn-link" disabled={busyId === c.id} onClick={() => setFormOpen(c)}>
                        Editar
                      </button>
                      {c.status !== 'DISABLED' && (
                        <button
                          className="btn-link"
                          disabled={busyId === c.id}
                          onClick={() => void toggleMaintenance(c)}
                        >
                          {c.status === 'AVAILABLE' ? 'A mantenimiento' : 'Reactivar'}
                        </button>
                      )}
                      {c.status !== 'DISABLED' && (
                        <button
                          className="btn-link btn-link-danger"
                          disabled={busyId === c.id}
                          onClick={() => void remove(c)}
                        >
                          Dar de baja
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <CourtFormDialog
          court={formOpen === 'new' ? null : formOpen}
          defaultSportId={courts[0]?.sportId}
          existingNumbers={courts.map((c) => c.number)}
          onClose={() => setFormOpen(null)}
          onSaved={(msg) => { setFormOpen(null); show(msg); void load(); }}
          onError={(msg) => show(msg, 'error')}
        />
      )}

      {canViewPrices && (
        <>
          <header className="screen-head" style={{ marginTop: 32 }}>
            <div>
              <h1 className="screen-title">Precios</h1>
              <p className="screen-sub">
                Tarifa por jugador. El turno se cobra × 4 (se juega siempre en dobles).
              </p>
            </div>
            {canManagePrices && (
              <div className="screen-actions">
                <button className="btn btn-primary" onClick={() => setRuleFormOpen('new')}>
                  Nueva regla
                </button>
              </div>
            )}
          </header>

          {rulesError ? (
            <div className="screen-empty">
              <p>No pudimos cargar las reglas de precio.</p>
            </div>
          ) : rules.length === 0 ? (
            <div className="screen-empty">
              <p>Todavía no hay reglas de precio cargadas.</p>
            </div>
          ) : (
            <div className="panel-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cancha</th>
                    <th>Día</th>
                    <th>Horario</th>
                    <th>Duración</th>
                    <th>Tipo</th>
                    <th>Por jugador</th>
                    <th>Turno (×4)</th>
                    {canManagePrices && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} style={r.isActive ? undefined : { opacity: 0.5 }}>
                      <td className="cell-main">{r.court?.name ?? 'Todas'}</td>
                      <td className="cell-muted">
                        {r.dayOfWeek === null ? 'Todos' : DAY_LABEL[r.dayOfWeek]}
                      </td>
                      <td className="cell-muted">
                        {r.fromMinute === null && r.toMinute === null
                          ? 'Todo el día'
                          : `${minuteToTime(r.fromMinute)}–${minuteToTime(r.toMinute)}`}
                      </td>
                      <td className="cell-muted">
                        {r.durationMinutes === null ? 'Cualquiera' : `${r.durationMinutes} min`}
                      </td>
                      <td className="cell-muted">
                        {r.bookingType === null ? 'Cualquiera' : BOOKING_TYPE_LABEL[r.bookingType] ?? r.bookingType}
                      </td>
                      <td className="cell-main">{formatMoney(r.price)}</td>
                      <td className="cell-main">{formatMoney(r.price * 4)}</td>
                      {canManagePrices && (
                        <td className="cell-actions">
                          <button
                            className="btn-link"
                            disabled={busyRuleId === r.id}
                            onClick={() => setRuleFormOpen(r)}
                          >
                            Editar
                          </button>
                          <button
                            className="btn-link btn-link-danger"
                            disabled={busyRuleId === r.id}
                            onClick={() => void removeRule(r)}
                          >
                            Borrar
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {ruleFormOpen && (
        <PriceRuleFormDialog
          rule={ruleFormOpen === 'new' ? null : ruleFormOpen}
          courts={courts}
          onClose={() => setRuleFormOpen(null)}
          onSaved={(msg) => { setRuleFormOpen(null); show(msg); void load(); }}
          onError={(msg) => show(msg, 'error')}
        />
      )}
    </div>
  );
}

function CourtFormDialog({
  court, defaultSportId, existingNumbers, onClose, onSaved, onError,
}: {
  court: Court | null;
  defaultSportId?: string;
  existingNumbers: number[];
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(court?.name ?? '');
  const [number, setNumber] = useState(
    court?.number ?? (existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1),
  );
  const [environment, setEnvironment] = useState(court?.environment ?? 'OUTDOOR');
  const [surface, setSurface] = useState(court?.surface ?? 'SYNTHETIC_GRASS');
  const [hasLighting, setHasLighting] = useState(court?.hasLighting ?? true);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (!name.trim()) {
      onError('Ponele un nombre a la cancha.');
      return;
    }
    setBusy(true);
    try {
      if (court) {
        await api.courts.update(court.id, { name: name.trim(), environment, surface, hasLighting });
        onSaved('Cancha actualizada.');
      } else {
        if (!defaultSportId) {
          onError('No se pudo determinar el deporte del club.');
          return;
        }
        await api.courts.create({
          sportId: defaultSportId, name: name.trim(), number, environment, surface, hasLighting,
        });
        onSaved('Cancha creada.');
      }
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'No pudimos guardar la cancha.');
    } finally {
      setBusy(false);
    }
  }, [court, name, number, environment, surface, hasLighting, defaultSportId, onSaved, onError]);

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Cancha">
        <h2 className="dialog-title">{court ? 'Editar cancha' : 'Nueva cancha'}</h2>

        <div className="field-pair">
          <label className="field-block">
            <span className="label">Nombre</span>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field-block">
            <span className="label">Número</span>
            <input
              className="input" type="number" min={1} value={number} disabled={!!court}
              onChange={(e) => setNumber(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="field-pair">
          <label className="field-block">
            <span className="label">Ambiente</span>
            <select className="input" value={environment} onChange={(e) => setEnvironment(e.target.value)}>
              {Object.entries(ENVIRONMENT_LABEL).map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </label>
          <label className="field-block">
            <span className="label">Superficie</span>
            <select className="input" value={surface} onChange={(e) => setSurface(e.target.value)}>
              {Object.entries(SURFACE_LABEL).map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="field-block" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={hasLighting} onChange={(e) => setHasLighting(e.target.checked)} />
          <span className="label" style={{ margin: 0 }}>Tiene iluminación</span>
        </label>

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Guardando…' : court ? 'Guardar' : 'Crear cancha'}
          </button>
        </div>
      </div>
    </div>
  );
}

const DURATION_OPTIONS = [60, 90, 120];

function PriceRuleFormDialog({
  rule, courts, onClose, onSaved, onError,
}: {
  rule: PriceRule | null;
  courts: Court[];
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [courtId, setCourtId] = useState(rule?.courtId ?? '');
  const [dayOfWeek, setDayOfWeek] = useState(rule?.dayOfWeek ?? -1);
  const [allDay, setAllDay] = useState(rule ? rule.fromMinute === null && rule.toMinute === null : true);
  const [fromTime, setFromTime] = useState(minuteToTime(rule?.fromMinute ?? null));
  const [toTime, setToTime] = useState(minuteToTime(rule?.toMinute ?? null));
  const [durationMinutes, setDurationMinutes] = useState(rule?.durationMinutes ?? 0);
  const [bookingType, setBookingType] = useState(rule?.bookingType ?? '');
  const [price, setPrice] = useState(rule ? String(rule.price) : '');
  const [priority, setPriority] = useState(rule?.priority ?? 0);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    const priceNum = Number(price);
    if (!price || Number.isNaN(priceNum) || priceNum < 0) {
      onError('Ingresá un precio por jugador válido.');
      return;
    }
    if (!allDay && fromTime && toTime && timeToMinute(fromTime)! >= timeToMinute(toTime)!) {
      onError('El horario "desde" debe ser anterior al "hasta".');
      return;
    }

    const payload = {
      courtId: courtId || null,
      dayOfWeek: dayOfWeek === -1 ? null : dayOfWeek,
      fromMinute: allDay ? null : timeToMinute(fromTime),
      toMinute: allDay ? null : timeToMinute(toTime),
      durationMinutes: durationMinutes === 0 ? null : durationMinutes,
      bookingType: bookingType || null,
      price: priceNum,
      priority,
    };

    setBusy(true);
    try {
      if (rule) {
        await api.priceRules.update(rule.id, payload);
        onSaved('Regla de precio actualizada.');
      } else {
        await api.priceRules.create({
          ...payload,
          courtId: payload.courtId ?? undefined,
          dayOfWeek: payload.dayOfWeek ?? undefined,
          fromMinute: payload.fromMinute ?? undefined,
          toMinute: payload.toMinute ?? undefined,
          durationMinutes: payload.durationMinutes ?? undefined,
          bookingType: payload.bookingType ?? undefined,
        });
        onSaved('Regla de precio creada.');
      }
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'No pudimos guardar la regla de precio.');
    } finally {
      setBusy(false);
    }
  }, [rule, courtId, dayOfWeek, allDay, fromTime, toTime, durationMinutes, bookingType, price, priority, onSaved, onError]);

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Regla de precio">
        <h2 className="dialog-title">{rule ? 'Editar regla de precio' : 'Nueva regla de precio'}</h2>
        <p className="dialog-sub">
          Cargá la tarifa por jugador. El turno se cobra × 4 al momento de reservar.
        </p>

        <div className="field-pair">
          <label className="field-block">
            <span className="label">Cancha</span>
            <select className="input" value={courtId} onChange={(e) => setCourtId(e.target.value)}>
              <option value="">Todas las canchas</option>
              {courts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="field-block">
            <span className="label">Día</span>
            <select
              className="input" value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
            >
              <option value={-1}>Todos los días</option>
              {DAY_LABEL.map((label, i) => (
                <option key={label} value={i}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="field-block" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          <span className="label" style={{ margin: 0 }}>Todo el día</span>
        </label>

        {!allDay && (
          <div className="field-pair">
            <label className="field-block">
              <span className="label">Desde</span>
              <input className="input" type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
            </label>
            <label className="field-block">
              <span className="label">Hasta</span>
              <input className="input" type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
            </label>
          </div>
        )}

        <div className="field-pair">
          <label className="field-block">
            <span className="label">Duración</span>
            <select
              className="input" value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
            >
              <option value={0}>Cualquiera</option>
              {DURATION_OPTIONS.map((d) => (
                <option key={d} value={d}>{d} min</option>
              ))}
            </select>
          </label>
          <label className="field-block">
            <span className="label">Tipo de turno</span>
            <select className="input" value={bookingType} onChange={(e) => setBookingType(e.target.value)}>
              <option value="">Cualquiera</option>
              {Object.entries(BOOKING_TYPE_LABEL).map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="field-pair">
          <label className="field-block">
            <span className="label">Precio por jugador</span>
            <input
              className="input" type="number" inputMode="decimal" min={0}
              value={price} onChange={(e) => setPrice(e.target.value)}
            />
            <span className="field-hint">
              {price && !Number.isNaN(Number(price))
                ? `Turno completo: ${formatMoney(Number(price) * 4)}`
                : 'El turno se cobra × 4 (se juega siempre en dobles).'}
            </span>
          </label>
          <label className="field-block">
            <span className="label">Prioridad</span>
            <input
              className="input" type="number" min={0}
              value={priority} onChange={(e) => setPriority(Number(e.target.value) || 0)}
            />
            <span className="field-hint">Desempata si dos reglas aplican por igual. Mayor gana.</span>
          </label>
        </div>

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Guardando…' : rule ? 'Guardar' : 'Crear regla'}
          </button>
        </div>
      </div>
    </div>
  );
}
