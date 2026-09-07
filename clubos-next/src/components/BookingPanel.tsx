import type { AgendaBooking, AgendaCourt } from '@/lib/api';
import { formatDuration, formatMinute, formatMoney } from '@/lib/grid';
import { blockColor } from './BookingBlock';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  PAID: 'Pagada',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Finalizada',
  CANCELLED_BY_CLIENT: 'Cancelada por el cliente',
  CANCELLED_BY_CLUB: 'Cancelada por el club',
  NO_SHOW: 'Ausente',
  RESCHEDULED: 'Reprogramada',
};

const TYPE_LABEL: Record<string, string> = {
  LESSON: 'Clase',
  TOURNAMENT: 'Torneo',
  MAINTENANCE: 'Mantenimiento',
  EVENT: 'Evento',
  ADMIN_BLOCK: 'Bloqueo',
};

const TERMINAL = ['COMPLETED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_CLUB', 'NO_SHOW', 'RESCHEDULED'];
const BLOCKING_TYPES = ['MAINTENANCE', 'EVENT', 'ADMIN_BLOCK'];

interface Props {
  booking: AgendaBooking | null;
  court: AgendaCourt | undefined;
  pending: boolean;
  can: (permission: string) => boolean;
  onClose: () => void;
  onCollect: (id: string, amount: number) => void;
  onCheckIn: (id: string) => void;
  onCheckOut: (id: string) => void;
  onCancel: (id: string) => void;
  onNoShow: (id: string) => void;
}

export function BookingPanel({
  booking, court, pending, can,
  onClose, onCollect, onCheckIn, onCheckOut, onCancel, onNoShow,
}: Props) {
  const open = booking !== null;

  return (
    <aside
      className={`panel${open ? ' is-open' : ''}`}
      aria-label="Detalle de la reserva"
      aria-hidden={!open}
    >
      {booking && (
        <>
          <header className="panel-head">
            <div className="panel-title">
              <div className="panel-code">{booking.code}</div>
              <h2 className="panel-name">{booking.title}</h2>
              <span
                className="status-pill"
                style={{
                  ['--bk-color' as string]: blockColor(booking),
                  ['--bk-bg' as string]: `color-mix(in srgb, ${blockColor(booking)} 18%, transparent)`,
                }}
              >
                {TYPE_LABEL[booking.type] ?? STATUS_LABEL[booking.status] ?? booking.status}
              </span>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Cerrar panel">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div className="panel-body">
            <dl className="field-group">
              <Field label="Cancha" value={court?.name ?? '—'} />
              <Field
                label="Horario"
                value={`${formatMinute(booking.startMinute)} – ${formatMinute(booking.endMinute)}`}
                strong
              />
              <Field label="Duración" value={formatDuration(booking.durationMinutes)} />
              {booking.playersCount > 0 && (
                <Field label="Jugadores" value={String(booking.playersCount)} />
              )}
              {booking.instructorName && (
                <Field label="Profesor" value={booking.instructorName} />
              )}
              {booking.clientPhone && (
                <Field label="Teléfono" value={booking.clientPhone} />
              )}
              {booking.checkInAt && (
                <Field
                  label="Llegó"
                  value={new Date(booking.checkInAt).toLocaleTimeString('es-AR', {
                    hour: '2-digit', minute: '2-digit',
                  })}
                />
              )}
            </dl>

            {booking.totalPrice > 0 && (
              <div className="money-row">
                <div>
                  <div className="money-label">
                    {booking.pendingAmount > 0 ? 'Falta cobrar' : 'Cobrado'}
                  </div>
                  <div className={`money-value${booking.pendingAmount > 0 ? ' is-owed' : ''}`}>
                    {formatMoney(
                      booking.pendingAmount > 0 ? booking.pendingAmount : booking.paidAmount,
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="money-label">Total del turno</div>
                  <div className="field-value">{formatMoney(booking.totalPrice)}</div>
                </div>
              </div>
            )}
          </div>

          <footer className="panel-actions">
            <PanelActions
              booking={booking}
              pending={pending}
              can={can}
              onCollect={onCollect}
              onCheckIn={onCheckIn}
              onCheckOut={onCheckOut}
              onCancel={onCancel}
              onNoShow={onNoShow}
            />
          </footer>
        </>
      )}
    </aside>
  );
}

function Field({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="field">
      <dt className="field-label">{label}</dt>
      <dd className={`field-value${strong ? ' is-strong' : ''}`}>{value}</dd>
    </div>
  );
}

/**
 * Acciones disponibles.
 *
 * Cada botón se muestra solo si el rol puede ejecutarlo y si el estado de la
 * reserva lo admite. Un botón que siempre falla con "sin permiso" enseña al
 * operador a ignorar los mensajes de error.
 */
function PanelActions({
  booking, pending, can, onCollect, onCheckIn, onCheckOut, onCancel, onNoShow,
}: {
  booking: AgendaBooking;
  pending: boolean;
  can: (p: string) => boolean;
  onCollect: (id: string, amount: number) => void;
  onCheckIn: (id: string) => void;
  onCheckOut: (id: string) => void;
  onCancel: (id: string) => void;
  onNoShow: (id: string) => void;
}) {
  const isBlock = BLOCKING_TYPES.includes(booking.type);
  const isTerminal = TERMINAL.includes(booking.status);
  const owes = booking.pendingAmount > 0 && !isBlock;

  if (isBlock) {
    return (
      <p className="panel-note">
        Es un bloqueo de cancha. Se edita desde la configuración del club.
      </p>
    );
  }

  if (isTerminal) {
    return (
      <p className="panel-note">
        {booking.status === 'COMPLETED'
          ? 'El turno ya se jugó.'
          : `Estado: ${STATUS_LABEL[booking.status] ?? booking.status}.`}
      </p>
    );
  }

  const actions: React.ReactNode[] = [];

  if (owes && can('payment.create')) {
    actions.push(
      <button
        key="collect"
        className="btn btn-primary"
        disabled={pending}
        onClick={() => onCollect(booking.id, booking.pendingAmount)}
      >
        {pending ? 'Cobrando…' : `Cobrar ${formatMoney(booking.pendingAmount)}`}
      </button>,
    );
  }

  const row: React.ReactNode[] = [];
  if (can('booking.checkin')) {
    row.push(
      booking.status === 'IN_PROGRESS' ? (
        <button key="out" className="btn btn-secondary" disabled={pending}
                onClick={() => onCheckOut(booking.id)}>
          Cerrar turno
        </button>
      ) : (
        <button key="in" className="btn btn-secondary" disabled={pending}
                onClick={() => onCheckIn(booking.id)}>
          Registrar llegada
        </button>
      ),
    );
  }
  if (can('booking.no_show') && booking.status !== 'IN_PROGRESS') {
    row.push(
      <button key="noshow" className="btn btn-secondary" disabled={pending}
              onClick={() => onNoShow(booking.id)}>
        No vino
      </button>,
    );
  }
  if (row.length) actions.push(<div key="row" className="btn-row">{row}</div>);

  if (can('booking.cancel')) {
    actions.push(
      <button key="cancel" className="btn btn-danger" disabled={pending}
              onClick={() => onCancel(booking.id)}>
        Cancelar turno
      </button>,
    );
  }

  if (actions.length === 0) {
    return <p className="panel-note">Tu rol no tiene acciones sobre este turno.</p>;
  }

  return <>{actions}</>;
}
