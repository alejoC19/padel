'use client';

import { useMemo, useState } from 'react';
import type { AgendaDay, AgendaBooking } from '@/lib/api';
import { formatMinute, formatMoney } from '@/lib/grid';

interface Props {
  day: AgendaDay;
  onSlotClick: (courtId: string, startMinute: number) => void;
  onBookingClick: (bookingId: string) => void;
}

/**
 * Agenda estilo "app de reserva" (Playtomic-like): se elige UNA cancha y se ven
 * sus turnos del día como tarjetas apiladas, con color por estado. Es la vista
 * pensada para vender: clara, se entiende en 2 segundos, y funciona en mobile.
 *
 * Usa los mismos datos del backend (day.courts, day.bookings). No cambia la
 * lógica de reservas: al tocar un slot libre llama onSlotClick (crear), y al
 * tocar una reserva llama onBookingClick (abrir panel).
 */

type Slot =
  | { kind: 'booked'; start: number; end: number; booking: AgendaBooking }
  | { kind: 'free'; start: number; end: number };

const ENV_LABEL: Record<string, string> = {
  INDOOR: 'Techada',
  OUTDOOR: 'Descubierta',
};

function stateOf(b: AgendaBooking): { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } {
  const s = b.status;
  if (s === 'CANCELLED_BY_CLIENT' || s === 'CANCELLED_BY_CLUB') return { label: 'Cancelada', tone: 'muted' };
  if (s === 'NO_SHOW') return { label: 'No vino', tone: 'danger' };
  if (b.paymentStatus === 'PAID') return { label: 'Pagada', tone: 'ok' };
  if (b.pendingAmount > 0 && b.paidAmount > 0) return { label: 'Seña', tone: 'warn' };
  if (b.pendingAmount > 0) return { label: 'A cobrar', tone: 'warn' };
  return { label: 'Reservada', tone: 'ok' };
}

export function AgendaBoard({ day, onSlotClick, onBookingClick }: Props) {
  const courts = day.courts;
  const [courtId, setCourtId] = useState(courts[0]?.id ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);

  const court = courts.find((c) => c.id === courtId) ?? courts[0];

  // Construye la línea de tiempo de la cancha: reservas + huecos libres.
  const slots = useMemo<Slot[]>(() => {
    if (!court) return [];
    const open = court.openMinute ?? day.openMinute;
    const close = court.closeMinute ?? day.closeMinute;
    const step = court.slotMinutes || 60;

    const bookings = day.bookings
      .filter((b) => b.courtId === court.id
        && b.status !== 'CANCELLED_BY_CLIENT' && b.status !== 'CANCELLED_BY_CLUB')
      .sort((a, b) => a.startMinute - b.startMinute);

    const out: Slot[] = [];
    let cursor = open;
    for (const b of bookings) {
      // Huecos libres antes de esta reserva, en pasos de "step".
      while (cursor + step <= b.startMinute) {
        out.push({ kind: 'free', start: cursor, end: cursor + step });
        cursor += step;
      }
      if (b.startMinute > cursor) {
        out.push({ kind: 'free', start: cursor, end: b.startMinute });
      }
      out.push({ kind: 'booked', start: b.startMinute, end: b.endMinute, booking: b });
      cursor = Math.max(cursor, b.endMinute);
    }
    while (cursor + step <= close) {
      out.push({ kind: 'free', start: cursor, end: cursor + step });
      cursor += step;
    }
    const lastSlot = out[out.length - 1];
    if (cursor < close && lastSlot && lastSlot.end < close) {
      out.push({ kind: 'free', start: cursor, end: close });
    }
    return out;
  }, [court, day]);

  if (!court) return null;

  return (
    <div className="board">
      {/* Selector de cancha con foto */}
      <div className="board-hero">
        <div className="board-hero-img" style={{ background: court.color }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="1.5" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="1.5" />
            <path d="M12 4v16M3 12h18" />
          </svg>
        </div>
        <button
          className="board-court-picker"
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
          aria-haspopup="listbox"
        >
          <span className="board-court-dot" style={{ background: court.color }} />
          <span className="board-court-name">{court.name}</span>
          <span className="board-court-env">{ENV_LABEL[court.environment] ?? ''}</span>
          <svg className={`board-chevron${pickerOpen ? ' open' : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {pickerOpen && (
          <div className="board-court-list" role="listbox">
            {courts.map((c) => (
              <button
                key={c.id}
                role="option"
                aria-selected={c.id === court.id}
                className={`board-court-opt${c.id === court.id ? ' is-active' : ''}`}
                onClick={() => { setCourtId(c.id); setPickerOpen(false); }}
              >
                <span className="board-court-dot" style={{ background: c.color }} />
                <span className="board-court-name">{c.name}</span>
                <span className="board-court-env">{ENV_LABEL[c.environment] ?? ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lista de turnos del día */}
      <div className="board-slots">
        {slots.length === 0 && (
          <div className="board-empty">Esta cancha no tiene horarios configurados para hoy.</div>
        )}

        {slots.map((slot) => {
          if (slot.kind === 'free') {
            return (
              <button
                key={`free-${slot.start}`}
                className="slot-card is-free"
                onClick={() => onSlotClick(court.id, slot.start)}
              >
                <div className="slot-time">
                  <span>{formatMinute(slot.start)}</span>
                  <span>{formatMinute(slot.end)}</span>
                </div>
                <div className="slot-body">
                  <span className="slot-state ok">
                    <span className="slot-dot ok" /> Disponible
                  </span>
                  <span className="slot-sub">
                    {Math.round((slot.end - slot.start))} min · hasta {court.capacity} jugadores
                  </span>
                </div>
                <span className="slot-book">Reservar</span>
              </button>
            );
          }

          const b = slot.booking;
          const st = stateOf(b);
          return (
            <button
              key={b.id}
              className={`slot-card is-${st.tone}`}
              onClick={() => onBookingClick(b.id)}
            >
              <div className="slot-time">
                <span>{formatMinute(slot.start)}</span>
                <span>{formatMinute(slot.end)}</span>
              </div>
              <div className="slot-body">
                <span className={`slot-state ${st.tone}`}>
                  <span className={`slot-dot ${st.tone}`} /> {st.label}
                </span>
                <span className="slot-name">{b.title || 'Sin titular'}</span>
                <span className="slot-sub">
                  {b.playersCount} jugadores
                  {b.pendingAmount > 0 && ` · falta ${formatMoney(b.pendingAmount)}`}
                  {b.paymentStatus === 'PAID' && ` · ${formatMoney(b.totalPrice)}`}
                </span>
              </div>
              {b.hasNotes && <span className="slot-note" title="Tiene notas">✎</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
