'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ClientSearchResult } from '@/lib/api';
import { DEMO_CLIENTS } from '@/lib/demo-data';
import { formatMoney } from '@/lib/grid';
import { useSession, useToasts } from '@/hooks';
import { Toasts } from '@/components/Toasts';
import { ClientProfile } from '@/components/ClientProfile';

/**
 * Clientes.
 *
 * ---------------------------------------------------------------------------
 * PARA QUÉ SE ABRE ESTA PANTALLA
 * ---------------------------------------------------------------------------
 * Casi siempre por una de tres razones: buscar a alguien puntual, ver quién
 * debe plata, o encontrar a los que dejaron de venir. Los filtros son
 * exactamente esos tres casos, no una lista genérica de campos.
 *
 * La búsqueda es lo primero y tiene el foco al entrar: es lo que se usa el
 * 80% de las veces.
 * ---------------------------------------------------------------------------
 */

interface ClientRow {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  status: string;
  accountBalance: number;
  totalSpent: number;
  bookingsCount: number;
  lastVisitAt: string | null;
  skillLevel: string | null;
  tags: Array<{ tag: { code: string; name: string; color: string } }>;
}

type Filter = 'all' | 'debtors' | 'inactive';

const SKILL_LABEL: Record<string, string> = {
  BEGINNER: 'Principiante',
  INTERMEDIATE: 'Intermedio',
  ADVANCED: 'Avanzado',
  PROFESSIONAL: 'Profesional',
};

export function ClientsScreen() {
  const { can, isDemo } = useSession();
  const { toasts, show, dismiss } = useToasts();

  const [rows, setRows] = useState<ClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [term, setTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async (f: Filter) => {
    setLoading(true);
    try {
      const res = await api.clients.list({
        debtorsOnly: f === 'debtors' || undefined,
        inactiveDays: f === 'inactive' ? 60 : undefined,
        sortBy: f === 'inactive' ? 'recent' : 'alpha',
        limit: 60,
      });
      setRows(res.items as ClientRow[]);
      setTotal(res.total);
      setDemo(false);
    } catch {
      // Sin backend: modo demo. Cargamos clientes de ejemplo en vez de
      // mostrar un cartel de error, para poder recorrer el producto.
      setRows(DEMO_CLIENTS.map(toRow));
      setTotal(DEMO_CLIENTS.length);
      setDemo(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
    searchRef.current?.focus();
  }, [filter, load]);

  /**
   * Búsqueda con debounce y control de orden.
   *
   * Sin número de secuencia, la respuesta de "gonz" puede llegar después de
   * la de "gonzalez" y pisar los resultados buenos.
   */
  const onSearch = useCallback((value: string) => {
    setTerm(value);
    clearTimeout(timerRef.current);
    const trimmed = value.trim();

    if (trimmed.length < 2) {
      setSearching(false);
      void load(filter);
      return;
    }

    const seq = ++seqRef.current;
    setSearching(true);
    timerRef.current = setTimeout(async () => {
      try {
        const found = await api.clients.search(trimmed, 40);
        if (seq !== seqRef.current) return;
        setRows(found.map(toRow));
        setTotal(found.length);
      } catch {
        if (seq === seqRef.current) setRows([]);
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 220);
  }, [filter, load]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // En demo NO cortamos con un cartel: la pantalla se renderiza normal con los
  // datos de ejemplo ya cargados. El badge "Datos de ejemplo" del AppShell y
  // el aviso de abajo dejan claro que es una demostración.

  return (
    <div className="clients-screen">
      {demo && (
        <div className="demo-note" role="status">
          <b>Modo demostración.</b> Estás viendo clientes de ejemplo. Los cambios no se guardan.
        </div>
      )}
      <header className="screen-head">
        <div>
          <h1 className="screen-title">Clientes</h1>
          <p className="screen-sub">
            {term.trim().length >= 2
              ? `${total} resultado${total === 1 ? '' : 's'} para “${term.trim()}”`
              : `${total} cliente${total === 1 ? '' : 's'}`}
          </p>
        </div>
        {(isDemo || can('client.create')) && (
          <div className="screen-actions">
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              Nuevo cliente
            </button>
          </div>
        )}
      </header>

      <div className="clients-toolbar">
        <div className="search-field">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
               stroke="var(--text-tertiary)" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={searchRef}
            className="search-inline"
            placeholder="Buscar por apellido, teléfono o documento…"
            value={term}
            onChange={(e) => onSearch(e.target.value)}
          />
          {searching && <span className="mini-spinner" aria-label="Buscando" />}
        </div>

        <div className="chip-row">
          {([
            ['all', 'Todos'],
            ['debtors', 'Con deuda'],
            ['inactive', 'Sin venir hace 60 días'],
          ] as Array<[Filter, string]>).map(([value, label]) => (
            <button
              key={value}
              className={`chip${filter === value ? ' is-active' : ''}`}
              onClick={() => { setTerm(''); setFilter(value); }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="card-empty">Cargando…</p>
      ) : rows.length === 0 ? (
        <div className="screen-empty">
          <p>
            {term.trim().length >= 2
              ? `No encontramos a nadie con “${term.trim()}”.`
              : filter === 'debtors'
                ? 'Nadie tiene deuda. Buena noticia.'
                : filter === 'inactive'
                  ? 'Todos vinieron en los últimos 60 días.'
                  : 'Todavía no hay clientes cargados.'}
          </p>
          {term.trim().length >= 2 && (
            <p className="muted">
              Probá con el apellido o los últimos dígitos del teléfono.
            </p>
          )}
        </div>
      ) : (
        <div className="panel-card">
          <table className="data-table is-clickable">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contacto</th>
                <th className="num">Turnos</th>
                <th>Última visita</th>
                <th className="num">Cuenta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} onClick={() => setSelectedId(c.id)} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(c.id); }}>
                  <td>
                    <div className="cell-main">
                      <span className="avatar">
                        {(c.firstName[0] ?? '') + (c.lastName[0] ?? '')}
                      </span>
                      <div>
                        <div className="cell-name">{c.firstName} {c.lastName}</div>
                        {(c.skillLevel || c.tags.length > 0) && (
                          <div className="cell-tags">
                            {c.skillLevel && (
                              <span className="tag-muted">
                                {SKILL_LABEL[c.skillLevel] ?? c.skillLevel}
                              </span>
                            )}
                            {c.tags.slice(0, 2).map((t) => (
                              <span
                                key={t.tag.code}
                                className="tag-color"
                                style={{
                                  ['--tag' as string]: t.tag.color,
                                }}
                              >
                                {t.tag.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="cell-muted">{c.phone ?? c.email ?? '—'}</td>
                  <td className="num">{c.bookingsCount}</td>
                  <td className="cell-muted">{formatLastVisit(c.lastVisitAt)}</td>
                  <td className="num">
                    {c.accountBalance < 0 ? (
                      <span className="balance-owed">
                        Debe {formatMoney(-c.accountBalance)}
                      </span>
                    ) : c.accountBalance > 0 ? (
                      <span className="balance-credit">
                        A favor {formatMoney(c.accountBalance)}
                      </span>
                    ) : (
                      <span className="cell-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId && (
        <ClientProfile
          clientId={selectedId}
          onClose={() => setSelectedId(null)}
          onError={(m) => show(m, 'error')}
        />
      )}

      {createOpen && (
        <CreateClientDialog
          onClose={() => setCreateOpen(false)}
          onCreated={async (name) => {
            setCreateOpen(false);
            await load(filter);
            show(`${name} quedó registrado.`);
          }}
          onError={(m) => show(m, 'error')}
        />
      )}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function toRow(r: ClientSearchResult): ClientRow {
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    phone: r.phone,
    email: r.email,
    status: r.status,
    accountBalance: r.accountBalance,
    totalSpent: 0,
    bookingsCount: 0,
    lastVisitAt: r.lastVisitAt,
    skillLevel: null,
    tags: [],
  };
}

/** "Hace 3 días" se lee más rápido que una fecha. */
function formatLastVisit(iso: string | null): string {
  if (!iso) return 'Nunca vino';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days < 30) return `Hace ${days} días`;
  if (days < 60) return 'Hace un mes';
  if (days < 365) return `Hace ${Math.floor(days / 30)} meses`;
  return 'Hace más de un año';
}

/**
 * Alta de cliente.
 *
 * El backend detecta duplicados: si el documento o el email ya existen,
 * bloquea; si solo el nombre es parecido, devuelve candidatos y espera
 * confirmación. El alta duplicada parte el historial en dos y después hay
 * que fusionar, que es mucho más caro que prevenir.
 */
function CreateClientDialog({
  onClose, onCreated, onError,
}: {
  onClose: () => void;
  onCreated: (name: string) => void;
  onError: (m: string) => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [duplicates, setDuplicates] = useState<Array<Record<string, unknown>> | null>(null);

  const submit = async (force = false) => {
    if (firstName.trim().length < 2 || lastName.trim().length < 2) {
      onError('Completá nombre y apellido.');
      return;
    }

    setBusy(true);
    try {
      const res = await api.clients.create({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        documentNumber: documentNumber.trim() || undefined,
        force,
      });

      if (res.requiresConfirmation && res.duplicates) {
        setDuplicates(res.duplicates as Array<Record<string, unknown>>);
        return;
      }
      onCreated(`${firstName.trim()} ${lastName.trim()}`);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo crear el cliente.');
    } finally {
      setBusy(false);
    }
  };

  if (duplicates) {
    return (
      <div className="overlay">
        <div className="dialog" role="dialog" aria-modal="true">
          <h2 className="dialog-title">Encontramos clientes parecidos</h2>
          <p className="dialog-sub">
            Revisá si alguno es la misma persona antes de crear uno nuevo.
          </p>
          <div className="dup-list">
            {duplicates.map((d, i) => (
              <div className="dup-item" key={i}>
                <span className="cell-name">
                  {String(d.firstName)} {String(d.lastName)}
                </span>
                <span className="cell-muted">
                  {d.phone ? String(d.phone) : 'sin teléfono'} ·{' '}
                  coincide por {String(d.matchedOn)}
                </span>
              </div>
            ))}
          </div>
          <div className="dialog-actions">
            <button className="btn btn-secondary" onClick={() => setDuplicates(null)}>
              Revisar datos
            </button>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void submit(true)}
            >
              Es otra persona, crear
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Nuevo cliente">
        <h2 className="dialog-title">Nuevo cliente</h2>

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

        <div className="field-pair">
          <label className="field-block">
            <span className="label">Teléfono</span>
            <input className="input" value={phone} inputMode="tel"
                   placeholder="11 4567-8900"
                   onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="field-block">
            <span className="label">Documento</span>
            <input className="input" value={documentNumber} inputMode="numeric"
                   onChange={(e) => setDocumentNumber(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
          </label>
        </div>

        <p className="field-hint">
          Con el teléfono alcanza para empezar. El resto se completa después.
        </p>

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Creando…' : 'Crear cliente'}
          </button>
        </div>
      </div>
    </div>
  );
}
