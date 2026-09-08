'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
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

export function CourtsScreen() {
  const { can } = useSession();
  const { toasts, show, dismiss } = useToasts();
  const canManage = can('court.manage');

  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [formOpen, setFormOpen] = useState<'new' | Court | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
  }, []);

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
