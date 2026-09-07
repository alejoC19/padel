import { memo } from 'react';
import type { AgendaBooking } from '@/lib/api';
import { formatMinute, formatMoney } from '@/lib/grid';

/**
 * Un bloque de reserva en la grilla.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTÁ MEMOIZADO
 * ---------------------------------------------------------------------------
 * Un día con cuatro canchas tiene entre 30 y 50 bloques. Durante un arrastre
 * el estado cambia en cada movimiento del mouse; sin `memo`, los 50 se
 * vuelven a renderizar decenas de veces por segundo y el arrastre se traba.
 *
 * La comparación se hace sobre los campos que afectan lo dibujado, no sobre
 * el objeto entero: el store devuelve objetos nuevos en cada actualización
 * y una igualdad por referencia nunca daría true.
 * ---------------------------------------------------------------------------
 */

/** Color por estado. El tipo pisa al estado: una clase se ve violeta aunque esté paga. */
const STATE_COLOR: Record<string, string> = {
  PENDING: 'var(--state-pending)',
  CONFIRMED: 'var(--state-confirmed)',
  PAID: 'var(--state-free)',
  IN_PROGRESS: 'var(--state-progress)',
  COMPLETED: 'var(--state-completed)',
  CANCELLED_BY_CLIENT: 'var(--state-cancelled)',
  CANCELLED_BY_CLUB: 'var(--state-cancelled)',
  NO_SHOW: 'var(--state-cancelled)',
  RESCHEDULED: 'var(--state-completed)',
};

const TYPE_COLOR: Record<string, string> = {
  LESSON: 'var(--state-lesson)',
  TOURNAMENT: 'var(--state-tournament)',
  MAINTENANCE: 'var(--state-maintenance)',
  EVENT: 'var(--state-maintenance)',
  ADMIN_BLOCK: 'var(--state-maintenance)',
};

export function blockColor(booking: AgendaBooking): string {
  return TYPE_COLOR[booking.type] ?? STATE_COLOR[booking.status] ?? 'var(--state-confirmed)';
}

const TERMINAL = ['COMPLETED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_CLUB', 'NO_SHOW', 'RESCHEDULED'];

interface Props {
  booking: AgendaBooking;
  top: number;
  height: number;
  selected: boolean;
  pending: boolean;
  onSelect: (id: string) => void;
  onDragStart: (id: string, e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function BookingBlockImpl({
  booking, top, height, selected, pending,
  onSelect, onDragStart, onDragEnd,
}: Props) {
  const color = blockColor(booking);
  const cancelled = booking.status.startsWith('CANCELLED') || booking.status === 'NO_SHOW';
  const movable = !TERMINAL.includes(booking.status);
  // Bajo cierta altura el texto no entra: se muestra solo la hora.
  const compact = height < 46;
  const owes = booking.pendingAmount > 0 &&
    booking.type !== 'MAINTENANCE' && booking.type !== 'TOURNAMENT';

  return (
    <button
      type="button"
      className={[
        'booking',
        compact && 'is-compact',
        selected && 'is-selected',
        pending && 'is-pending',
        cancelled && 'is-cancelled',
      ].filter(Boolean).join(' ')}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        // Variables locales: el CSS las usa para borde y fondo sin que haya
        // que generar una clase por estado.
        ['--bk-color' as string]: color,
        ['--bk-bg' as string]: `color-mix(in srgb, ${color} 18%, transparent)`,
      }}
      draggable={movable && !pending}
      onClick={() => onSelect(booking.id)}
      onDragStart={(e) => onDragStart(booking.id, e)}
      onDragEnd={onDragEnd}
      aria-label={
        `${booking.title}, ${formatMinute(booking.startMinute)} a ` +
        `${formatMinute(booking.endMinute)}` +
        (owes ? `, falta cobrar ${formatMoney(booking.pendingAmount)}` : '')
      }
    >
      <span className="bk-time">
        {formatMinute(booking.startMinute)} – {formatMinute(booking.endMinute)}
      </span>
      {!compact && (
        <>
          <span className="bk-name">{booking.title}</span>
          <span className="bk-foot">
            {booking.playersCount > 0 && <span>{booking.playersCount}p</span>}
            {owes && <span className="bk-unpaid">· falta {formatMoney(booking.pendingAmount)}</span>}
            {booking.instructorName && <span>· {booking.instructorName}</span>}
            {booking.checkInAt && <span className="bk-here">· llegó</span>}
          </span>
        </>
      )}
      {booking.hasNotes && <span className="bk-note-dot" aria-hidden="true" />}
    </button>
  );
}

export const BookingBlock = memo(BookingBlockImpl, (prev, next) => {
  const a = prev.booking;
  const b = next.booking;
  return (
    a.id === b.id &&
    a.startMinute === b.startMinute &&
    a.endMinute === b.endMinute &&
    a.courtId === b.courtId &&
    a.status === b.status &&
    a.type === b.type &&
    a.title === b.title &&
    a.pendingAmount === b.pendingAmount &&
    a.checkInAt === b.checkInAt &&
    prev.top === next.top &&
    prev.height === next.height &&
    prev.selected === next.selected &&
    prev.pending === next.pending
  );
});
