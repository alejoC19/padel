import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ClientSearchResult } from '@/lib/api';
import { formatMoney } from '@/lib/grid';

/**
 * Búsqueda de clientes.
 *
 * ---------------------------------------------------------------------------
 * DEBOUNCE Y ORDEN DE RESPUESTAS
 * ---------------------------------------------------------------------------
 * Recepción escribe mientras habla por teléfono. Sin debounce, "gonzalez"
 * dispara ocho requests; y sin número de secuencia, la respuesta de "gonz"
 * puede llegar después de la de "gonzalez" y dejar en pantalla resultados
 * viejos sobre los buenos.
 *
 * El contador de secuencia resuelve las dos cosas: solo se pinta la respuesta
 * de la última búsqueda pedida.
 * ---------------------------------------------------------------------------
 */

interface Props {
  open: boolean;
  demoResults?: ClientSearchResult[];
  onClose: () => void;
  onPick: (client: ClientSearchResult) => void;
}

export function ClientSearch({ open, demoResults, onClose, onPick }: Props) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<ClientSearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (open) {
      setTerm('');
      setResults(demoResults?.slice(0, 5) ?? []);
      setActive(0);
      setCreating(false);
      // El foco va después del render para que el input ya exista.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, demoResults]);

  const search = useCallback((q: string) => {
    clearTimeout(timerRef.current);
    const trimmed = q.trim();

    if (demoResults) {
      const norm = (s: string) =>
        s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const n = norm(trimmed);
      setResults(
        n.length === 0
          ? demoResults.slice(0, 5)
          : demoResults.filter((c) =>
              norm(`${c.firstName} ${c.lastName} ${c.phone ?? ''} ${c.documentNumber ?? ''}`).includes(n),
            ),
      );
      setActive(0);
      return;
    }

    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    const seq = ++seqRef.current;
    setSearching(true);
    timerRef.current = setTimeout(async () => {
      try {
        const found = await api.clients.search(trimmed, 8);
        if (seq !== seqRef.current) return;  // llegó tarde
        setResults(found);
        setActive(0);
      } catch {
        if (seq === seqRef.current) setResults([]);
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 220);
  }, [demoResults]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[active];
      if (picked) onPick(picked);
    }
  };

  return (
    <div
      className="client-search-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Buscar cliente"
    >
      <div className="search-box" onKeyDown={onKeyDown}>
        <div className="search-input-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="var(--text-tertiary)" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            className="search-input"
            value={term}
            onChange={(e) => { setTerm(e.target.value); search(e.target.value); }}
            placeholder="Buscar por nombre, teléfono o documento"
            autoComplete="off"
            aria-label="Buscar cliente"
          />
          {searching && <span className="mini-spinner" aria-label="Buscando" />}
          <kbd className="search-hint">Esc</kbd>
        </div>

        {creating ? (
          <QuickCreateClient
            initialName={term}
            onCancel={() => setCreating(false)}
            onCreated={onPick}
          />
        ) : (
          <>
            <div className="search-results">
              {results.length === 0 ? (
                <p className="search-empty">
                  {term.trim().length < 2
                    ? 'Escribí al menos 2 letras del apellido.'
                    : (
                      <>
                        No encontramos a nadie con “{term}”.
                        <span className="search-empty-hint">
                          Probá con el apellido o los últimos dígitos del teléfono.
                        </span>
                      </>
                    )}
                </p>
              ) : (
                results.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`search-item${i === active ? ' is-active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => onPick(c)}
                  >
                    <span className="avatar">
                      {(c.firstName[0] ?? '') + (c.lastName[0] ?? '')}
                    </span>
                    <span className="search-item-main">
                      <span className="search-name">{c.firstName} {c.lastName}</span>
                      <span className="search-meta">
                        {c.phone ?? c.documentNumber ?? 'Sin contacto'}
                      </span>
                    </span>
                    {c.accountBalance < 0 && (
                      <span className="balance-owed">
                        Debe {formatMoney(-c.accountBalance)}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>

            {/* Modo demo no tiene backend real: no ofrecemos alta ahí. */}
            {!demoResults && (
              <button type="button" className="search-new-client" onClick={() => setCreating(true)}>
                + Cliente nuevo
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Alta rápida sin salir del flujo de reserva/inscripción.
 *
 * Solo lo mínimo para poder avisarle algo a esa persona: nombre, teléfono,
 * email. Nada de documento acá — eso se completa después desde la ficha si
 * hace falta, no es necesario para reservar una cancha.
 */
function QuickCreateClient({
  initialName, onCancel, onCreated,
}: {
  initialName: string;
  onCancel: () => void;
  onCreated: (client: ClientSearchResult) => void;
}) {
  const [firstName, setFirstName] = useState(initialName);
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (firstName.trim().length < 2 || lastName.trim().length < 2) {
      setError('Completá nombre y apellido.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.clients.create({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      if (res.requiresConfirmation) {
        setError('Ya existe un cliente parecido. Buscalo en vez de crear uno nuevo.');
        return;
      }
      onCreated({
        id: res.id!,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        documentNumber: null,
        status: 'ACTIVE',
        accountBalance: 0,
        lastVisitAt: null,
        score: 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el cliente.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="search-quick-create">
      <div className="field-pair">
        <label className="field-block">
          <span className="label">Nombre</span>
          <input className="input" autoFocus value={firstName}
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
          <span className="label">Email</span>
          <input className="input" type="email" value={email}
                 onChange={(e) => setEmail(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
        </label>
      </div>
      {error && <p className="field-error">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Creando…' : 'Crear y usar'}
        </button>
      </div>
    </div>
  );
}
