'use client';

/**
 * Confirmación de una acción destructiva o irreversible.
 *
 * Reemplaza el `confirm()` nativo del navegador, que usan (por copy-paste)
 * varias pantallas: AgendaScreen, TournamentsScreen, TeamScreen,
 * CourtsScreen. Un `confirm()` nativo no tiene el tema visual de la app, no
 * se puede estilar, y en Safari/iOS aparece con el texto del dominio en vez
 * del mensaje — nada de eso transmite "producto profesional".
 *
 * Deliberadamente chico: título + mensaje + dos botones. No es un Modal
 * genérico de contenido libre — para eso está `.overlay`/`.dialog`.
 */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** El botón de confirmar se pinta en rojo (para "cancelar turno", "eliminar", etc). */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar',
  danger, busy, onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2 className="dialog-title">{title}</h2>
        <p className="confirm-message">{message}</p>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Un momento…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
