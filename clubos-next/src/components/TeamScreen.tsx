'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useSession, useToasts } from '@/hooks';
import { Toasts } from '@/components/Toasts';

/**
 * Equipo del club: alta y administración de staff (recepción, profesores,
 * administradores).
 *
 * No tiene modo demo con datos de ejemplo — a diferencia de agenda/clientes,
 * mostrar personas y emails inventados acá es más confuso que útil, y es una
 * pantalla que casi nadie abre en una demo de venta.
 */

interface Member {
  id: string;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  invitedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  role: { id: string; code: string; name: string };
  user: {
    id: string; email: string; firstName: string; lastName: string;
    avatarUrl: string | null; isActive: boolean; lastLoginAt: string | null;
  };
}

interface RoleOption {
  id: string;
  code: string;
  name: string;
}

const STATUS_LABEL: Record<Member['status'], string> = {
  INVITED: 'Invitación pendiente',
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
  REVOKED: 'Baja',
};

export function TeamScreen() {
  const { can } = useSession();
  const { toasts, show, dismiss } = useToasts();
  const canManage = can('user.manage');
  const canInvite = can('user.invite');

  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, r] = await Promise.all([api.team.list(), api.team.roles()]);
      setMembers(m);
      setRoles(r);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const changeRole = useCallback(async (id: string, roleId: string) => {
    setBusyId(id);
    try {
      await api.team.update(id, { roleId });
      show('Rol actualizado.');
      await load();
    } catch (e) {
      show(e instanceof ApiError ? e.message : 'No pudimos cambiar el rol.', 'error');
    } finally {
      setBusyId(null);
    }
  }, [load, show]);

  const toggleStatus = useCallback(async (m: Member) => {
    const next = m.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setBusyId(m.id);
    try {
      await api.team.update(m.id, { status: next });
      show(next === 'ACTIVE' ? 'Reactivado.' : 'Suspendido.');
      await load();
    } catch (e) {
      show(e instanceof ApiError ? e.message : 'No pudimos actualizar el estado.', 'error');
    } finally {
      setBusyId(null);
    }
  }, [load, show]);

  const remove = useCallback(async (m: Member) => {
    if (!confirm(`¿Quitar a ${m.user.firstName} ${m.user.lastName} del club?`)) return;
    setBusyId(m.id);
    try {
      await api.team.remove(m.id);
      show('Se quitó del club.');
      await load();
    } catch (e) {
      show(e instanceof ApiError ? e.message : 'No pudimos quitarlo del club.', 'error');
    } finally {
      setBusyId(null);
    }
  }, [load, show]);

  return (
    <div className="team-screen">
      <Toasts toasts={toasts} onDismiss={dismiss} />

      <header className="screen-head">
        <div>
          <h1 className="screen-title">Equipo</h1>
          <p className="screen-sub">
            {members.length} persona{members.length === 1 ? '' : 's'} con acceso al club
          </p>
        </div>
        {canInvite && (
          <div className="screen-actions">
            <button className="btn btn-primary" onClick={() => setInviteOpen(true)}>
              Invitar
            </button>
          </div>
        )}
      </header>

      {loading ? (
        <p className="card-empty">Cargando…</p>
      ) : error ? (
        <div className="screen-empty">
          <p>No pudimos cargar el equipo.</p>
          <p className="muted">Verificá tu conexión e intentá de nuevo.</p>
        </div>
      ) : members.length === 0 ? (
        <div className="screen-empty">
          <p>Todavía no invitaste a nadie más.</p>
        </div>
      ) : (
        <div className="panel-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Último acceso</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="cell-main">
                      <span className="avatar">
                        {(m.user.firstName[0] ?? '') + (m.user.lastName[0] ?? '')}
                      </span>
                      <div>
                        <div className="cell-name">{m.user.firstName} {m.user.lastName}</div>
                        <div className="cell-muted">{m.user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {canManage && m.status !== 'REVOKED' ? (
                      <select
                        className="input"
                        value={m.role.id}
                        disabled={busyId === m.id}
                        onChange={(e) => void changeRole(m.id, e.target.value)}
                      >
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    ) : (
                      m.role.name
                    )}
                  </td>
                  <td>
                    <span className={`status-pill ${
                      m.status === 'ACTIVE' ? 'success'
                        : m.status === 'SUSPENDED' || m.status === 'REVOKED' ? 'danger'
                          : 'info'
                    }`}>
                      {STATUS_LABEL[m.status]}
                    </span>
                  </td>
                  <td className="cell-muted">
                    {m.user.lastLoginAt
                      ? new Date(m.user.lastLoginAt).toLocaleDateString('es-AR')
                      : '—'}
                  </td>
                  {canManage && (
                    <td className="cell-actions">
                      {m.status !== 'REVOKED' && (
                        <>
                          <button
                            className="btn-link"
                            disabled={busyId === m.id}
                            onClick={() => void toggleStatus(m)}
                          >
                            {m.status === 'ACTIVE' ? 'Suspender' : 'Reactivar'}
                          </button>
                          <button
                            className="btn-link btn-link-danger"
                            disabled={busyId === m.id}
                            onClick={() => void remove(m)}
                          >
                            Quitar
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {inviteOpen && (
        <InviteDialog
          roles={roles}
          onClose={() => setInviteOpen(false)}
          onInvited={(msg) => { setInviteOpen(false); show(msg); void load(); }}
          onError={(msg) => show(msg, 'error')}
        />
      )}
    </div>
  );
}

function InviteDialog({
  roles, onClose, onInvited, onError,
}: {
  roles: RoleOption[];
  onClose: () => void;
  onInvited: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [roleId, setRoleId] = useState(roles.find((r) => r.code === 'RECEPTION')?.id ?? roles[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (!email.trim() || !firstName.trim() || !lastName.trim() || !roleId) {
      onError('Completá todos los campos.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.team.invite({
        email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim(), roleId,
      });
      onInvited(
        res.status === 'INVITED'
          ? 'Invitación enviada por email.'
          : 'Se agregó al club — ya puede entrar con su cuenta.',
      );
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'No pudimos enviar la invitación.');
    } finally {
      setBusy(false);
    }
  }, [email, firstName, lastName, roleId, onInvited, onError]);

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Invitar al equipo">
        <h2 className="dialog-title">Invitar al equipo</h2>

        <label className="field-block">
          <span className="label">Email</span>
          <input
            className="input" type="email" autoFocus value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <div className="field-pair">
          <label className="field-block">
            <span className="label">Nombre</span>
            <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="field-block">
            <span className="label">Apellido</span>
            <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
        </div>

        <label className="field-block">
          <span className="label">Rol</span>
          <select className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>

        <p className="field-hint">
          Si ya tiene cuenta en ClubOS se agrega directo. Si no, le mandamos un
          email para que cree su contraseña.
        </p>

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Enviando…' : 'Invitar'}
          </button>
        </div>
      </div>
    </div>
  );
}
