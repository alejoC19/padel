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
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (open) {
      setTerm('');
      setResults(demoResults?.slice(0, 5) ?? []);
      setActive(0);
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
      </div>
    </div>
  );
}
