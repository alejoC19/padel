import type { Toast } from '@/hooks';

/**
 * Avisos efímeros.
 *
 * `aria-live="polite"` en el contenedor: el lector de pantalla los anuncia
 * cuando termina lo que está leyendo, sin interrumpir. Para errores de cobro
 * eso alcanza — no son alarmas, son confirmaciones de que algo no salió.
 */
export function Toasts({ toasts, onDismiss }: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.kind === 'error' ? ' is-error' : ''}`}>
          <span className="toast-icon" aria-hidden="true">
            {t.kind === 'error' ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2.2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </span>
          <span>{t.message}</span>
          <button
            className="toast-close"
            onClick={() => onDismiss(t.id)}
            aria-label="Descartar aviso"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.4">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
