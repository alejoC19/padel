'use client';

import { useMemo } from 'react';
import type { AgendaDay, AgendaBooking } from '@/lib/api';
import { currentMinuteOfDay, formatMinute, formatMoney, isToday } from '@/lib/grid';

interface Props {
  day: AgendaDay;
  courtId: string;
  onSlotClick: (courtId: string, startMinute: number) => void;
  onBookingClick: (bookingId: string) => void;
}

/**
 * Agenda estilo "app de reserva" (Playtomic-like): UNA cancha por vez, sus
 * turnos del día como tarjetas apiladas con color por estado. Clara, se
 * entiende en 2 segundos, y funciona en mobile.
 *
 * Qué cancha se ve es responsabilidad de `CourtOverviewStrip`, que vive
 * arriba en AgendaScreen (antes este componente tenía su propio selector
 * con menú desplegable; se sacó porque la tira ya cumple esa función y
 * ADEMÁS muestra el estado de cada cancha, algo que un simple dropdown de
 * nombres no podía).
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

export function AgendaBoard({ day, courtId, onSlotClick, onBookingClick }: Props) {
  const courts = day.courts;
  const court = courts.find((c) => c.id === courtId) ?? courts[0];

  // Construye la línea de tiempo de la cancha: reservas + huecos libres.
  //
  // Cada hueco libre se corta en filas de `slotMinutes` (default 60, en
  // punto: 13:00, 14:00, 15:00...), no en un solo bloque continuo — un
  // bloque de "480 min" de largo no dice nada útil y, peor, al tocarlo la
  // reserva arranca siempre en el inicio del bloque aunque ya haya pasado
  // (si son las 17hs y el bloque libre empieza a las 08:00, tocarlo intenta
  // reservar las 08:00). Con una fila por horario, cada una abre la reserva
  // exactamente en ESE horario.
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
    if (cursor < close && (!lastSlot || lastSlot.end < close)) {
      out.push({ kind: 'free', start: cursor, end: close });
    }
    return out;
  }, [court, day]);

  if (!court) return null;

  // Solo tiene sentido comparar contra la hora actual si el día que se está
  // mirando es hoy — si no, cualquier horario de un día futuro que coincida
  // con la hora actual del reloj se marcaría "ahora" o "pasado" por error.
  const today = isToday(day.date);
  const now = today ? currentMinuteOfDay(day.timezone) : -1;

  return (
    <div className="board">
      {/* Foto de la cancha elegida (el selector real es CourtOverviewStrip, arriba) */}
      <div className="board-hero">
        <div
          className="board-hero-img"
          style={{
            backgroundColor: court.color,
            backgroundImage: `url(/illustrations/court-${court.environment === 'OUTDOOR' ? 'outdoor' : 'indoor'}.jpg)`,
          }}
        />
        <div className="board-court-label">
          <span className="board-court-dot" style={{ background: court.color }} />
          <span className="board-court-name">{court.name}</span>
          <span className="board-court-env">{ENV_LABEL[court.environment] ?? ''}</span>
        </div>
      </div>

      {/* Lista de turnos del día */}
      <div className="board-slots">
        {slots.length === 0 && (
          <div className="board-empty">Esta cancha no tiene horarios configurados para hoy.</div>
        )}

        {slots.map((slot) => {
          const isNow = now >= slot.start && now < slot.end;

          if (slot.kind === 'free') {
            // Pasado (ya no se puede reservar) es distinto de ocupado: el
            // backend igual lo rechazaría, pero mostrarlo igual que un
            // horario disponible es lo que confundía — "¿por qué me deja
            // tocar las 08:00 si ya son las 17hs?".
            const isPast = today && slot.start < now;
            if (isPast) {
              return (
                <div
                  key={`free-${slot.start}`}
                  className="slot-card is-past"
                  aria-disabled="true"
                >
                  <div className="slot-time">
                    <span>{formatMinute(slot.start)}</span>
                    <span>{formatMinute(slot.end)}</span>
                  </div>
                  <div className="slot-body">
                    <span className="slot-state past">
                      <span className="slot-dot past" /> Horario pasado
                    </span>
                  </div>
                </div>
              );
            }
            return (
              <button
                key={`free-${slot.start}`}
                className={`slot-card is-free${isNow ? ' is-now' : ''}`}
                onClick={() => onSlotClick(court.id, slot.start)}
              >
                <div className="slot-time">
                  <span>{formatMinute(slot.start)}</span>
                  <span>{formatMinute(slot.end)}</span>
                </div>
                <div className="slot-body">
                  <span className="slot-state ok">
                    <span className="slot-dot ok" /> Disponible
                    {isNow && <span className="slot-now-tag">Ahora</span>}
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
              className={`slot-card is-${st.tone}${isNow ? ' is-now' : ''}`}
              onClick={() => onBookingClick(b.id)}
            >
              <div className="slot-time">
                <span>{formatMinute(slot.start)}</span>
                <span>{formatMinute(slot.end)}</span>
              </div>
              <div className="slot-body">
                <span className={`slot-state ${st.tone}`}>
                  <span className={`slot-dot ${st.tone}`} /> {st.label}
                  {isNow && <span className="slot-now-tag">Ahora</span>}
                </span>
                <span className="slot-name">{b.title || 'Sin titular'}</span>
                <span className="slot-sub">
                  {b.playersCount} jugadores
                  {b.pendingAmount > 0 && ` · falta ${formatMoney(b.pendingAmount)}`}
                  {b.paymentStatus === 'PAID' && ` · ${formatMoney(b.totalPrice)}`}
                </span>
              </div>
              <svg className="slot-occupied-mark" width="16" height="16" viewBox="0 0 24 24"
                   fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                   aria-label="Ocupado">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
              {b.hasNotes && (
                <svg className="slot-note" width="15" height="15" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" strokeWidth="2" aria-label="Tiene notas">
                  <path d="M4 4h16v12H8l-4 4V4z" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
