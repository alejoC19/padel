import { useCallback, useMemo, useRef, useState } from 'react';
import type { AgendaCourt, AgendaBooking, AgendaDay } from '@/lib/api';
import {
  MINUTE_PX, formatMinute, minuteToY, snapMinute, timeTicks, yToMinute,
} from '@/lib/grid';
import { BookingBlock } from './BookingBlock';

interface DragState {
  bookingId: string;
  durationMinutes: number;
  /** Dónde agarró el bloque, para que no salte bajo el cursor. */
  grabOffsetMinutes: number;
}

interface GhostState {
  courtId: string;
  startMinute: number;
  endMinute: number;
  valid: boolean;
}

interface Props {
  day: AgendaDay;
  selectedId: string | null;
  pendingIds: Set<string>;
  nowMinute: number | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, courtId: string, startMinute: number) => void;
  onCreateAt: (courtId: string, startMinute: number) => void;
  onDragChange: (dragging: boolean) => void;
}

export function TimeGrid({
  day, selectedId, pendingIds, nowMinute,
  onSelect, onMove, onCreateAt, onDragChange,
}: Props) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const win = { openMinute: day.openMinute, closeMinute: day.closeMinute };
  const height = (day.closeMinute - day.openMinute) * MINUTE_PX;
  const ticks = useMemo(() => timeTicks(win), [day.openMinute, day.closeMinute]);

  // Reservas por cancha: evita filtrar el array completo dentro del map.
  const byCourt = useMemo(() => {
    const m = new Map<string, AgendaBooking[]>();
    for (const c of day.courts) m.set(c.id, []);
    for (const b of day.bookings) m.get(b.courtId)?.push(b);
    return m;
  }, [day.courts, day.bookings]);

  /**
   * Huecos libres de una cancha.
   *
   * Se calculan como el complemento de lo ocupado, no marcando slots libres
   * uno por uno: así un hueco de tres horas es un solo elemento clickeable
   * en vez de seis franjas de 30 minutos pegadas.
   */
  const freeGaps = useCallback((courtId: string, court: AgendaCourt) => {
    const open = court.openMinute ?? day.openMinute;
    const close = court.closeMinute ?? day.closeMinute;
    const busy = (byCourt.get(courtId) ?? [])
      .filter((b) => !b.status.startsWith('CANCELLED') && b.status !== 'NO_SHOW')
      .map((b) => ({ start: b.startMinute, end: b.endMinute }))
      .concat(
        day.blocks
          .filter((bl) => bl.courtId === courtId || bl.courtId === null)
          .map((bl) => ({ start: bl.startMinute, end: bl.endMinute })),
      )
      .sort((a, b) => a.start - b.start);

    const gaps: Array<{ start: number; end: number }> = [];
    let cursor = open;
    for (const b of busy) {
      if (b.start > cursor) gaps.push({ start: cursor, end: Math.min(b.start, close) });
      cursor = Math.max(cursor, b.end);
    }
    if (cursor < close) gaps.push({ start: cursor, end: close });
    return gaps.filter((g) => g.end - g.start >= 15);
  }, [byCourt, day.blocks, day.openMinute, day.closeMinute]);

  const isFree = useCallback(
    (courtId: string, start: number, end: number, ignoreId: string) =>
      !(byCourt.get(courtId) ?? []).some(
        (b) =>
          b.id !== ignoreId &&
          !b.status.startsWith('CANCELLED') &&
          b.status !== 'NO_SHOW' &&
          start < b.endMinute && end > b.startMinute,
      ) &&
      !day.blocks.some(
        (bl) =>
          (bl.courtId === courtId || bl.courtId === null) &&
          start < bl.endMinute && end > bl.startMinute,
      ),
    [byCourt, day.blocks],
  );

  const handleDragStart = useCallback((id: string, e: React.DragEvent) => {
    const b = day.bookings.find((x) => x.id === id);
    if (!b) return;

    // Punto exacto donde agarró, para que el bloque no salte al soltar.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const grabOffsetMinutes = (e.clientY - rect.top) / MINUTE_PX;

    setDrag({ bookingId: id, durationMinutes: b.durationMinutes, grabOffsetMinutes });
    onDragChange(true);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox no inicia el arrastre sin setData.
    e.dataTransfer.setData('text/plain', id);
  }, [day.bookings, onDragChange]);

  const handleDragEnd = useCallback(() => {
    setDrag(null);
    setGhost(null);
    onDragChange(false);
  }, [onDragChange]);

  const handleDragOver = useCallback((courtId: string, e: React.DragEvent) => {
    if (!drag) return;
    e.preventDefault();

    const rect = e.currentTarget.getBoundingClientRect();
    const rawMinute = yToMinute(e.clientY - rect.top, win) - drag.grabOffsetMinutes;
    const start = snapMinute(rawMinute, 30);
    const end = start + drag.durationMinutes;

    setGhost({
      courtId,
      startMinute: start,
      endMinute: end,
      valid:
        isFree(courtId, start, end, drag.bookingId) &&
        start >= day.openMinute &&
        end <= day.closeMinute,
    });
  }, [drag, isFree, day.openMinute, day.closeMinute, win]);

  const handleDrop = useCallback((courtId: string, e: React.DragEvent) => {
    if (!drag) return;
    e.preventDefault();

    const rect = e.currentTarget.getBoundingClientRect();
    const rawMinute = yToMinute(e.clientY - rect.top, win) - drag.grabOffsetMinutes;
    const start = snapMinute(rawMinute, 30);

    setDrag(null);
    setGhost(null);
    onDragChange(false);
    onMove(drag.bookingId, courtId, start);
  }, [drag, onMove, onDragChange, win]);

  return (
    <div className="grid-scroll" ref={scrollRef}>
      <div className="grid">
        {/* regla horaria */}
        <div className="gutter">
          <div className="gutter-head" />
          <div className="gutter-body" style={{ height }}>
            {ticks.filter((t) => t.label).map((t) => (
              <span key={t.minute} className="tick-label" style={{ top: t.y }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>

        {day.courts.map((court) => {
          const bookings = byCourt.get(court.id) ?? [];
          const closed = court.openMinute === null;

          return (
            <div className="court-col" key={court.id}>
              <div className="court-head">
                <span className="court-swatch" style={{ background: court.color }} />
                <span className="court-name">{court.name}</span>
                <span className="court-meta">
                  {closed ? 'Cerrada' : court.environment === 'INDOOR' ? 'Techada' : 'Descubierta'}
                </span>
              </div>

              <div
                className={`court-body${closed ? ' is-closed' : ''}`}
                style={{ height }}
                onDragOver={(e) => !closed && handleDragOver(court.id, e)}
                onDrop={(e) => !closed && handleDrop(court.id, e)}
              >
                {ticks.map((t) => (
                  <span
                    key={t.minute}
                    className={`gridline ${t.major ? 'is-major' : 'is-minor'}`}
                    style={{ top: t.y }}
                  />
                ))}

                {!closed && freeGaps(court.id, court).map((gap) => (
                  <button
                    type="button"
                    key={`${court.id}-${gap.start}`}
                    className="slot"
                    style={{
                      top: minuteToY(gap.start, win),
                      height: (gap.end - gap.start) * MINUTE_PX,
                    }}
                    onClick={() => onCreateAt(court.id, gap.start)}
                    aria-label={`Reservar ${court.name} de ${formatMinute(gap.start)} a ${formatMinute(gap.end)}`}
                  >
                    <span className="slot-plus" aria-hidden="true">+</span>
                  </button>
                ))}

                {bookings.map((b) => (
                  <BookingBlock
                    key={b.id}
                    booking={b}
                    top={minuteToY(b.startMinute, win)}
                    height={Math.max((b.endMinute - b.startMinute) * MINUTE_PX, 26)}
                    selected={b.id === selectedId}
                    pending={pendingIds.has(b.id)}
                    onSelect={onSelect}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  />
                ))}

                {ghost?.courtId === court.id && (
                  <div
                    className={`ghost${ghost.valid ? '' : ' is-invalid'}`}
                    style={{
                      top: minuteToY(ghost.startMinute, win),
                      height: (ghost.endMinute - ghost.startMinute) * MINUTE_PX,
                    }}
                  >
                    <span className="ghost-label">
                      {formatMinute(ghost.startMinute)} – {formatMinute(ghost.endMinute)}
                      {!ghost.valid && ' · ocupado'}
                    </span>
                  </div>
                )}

                {nowMinute !== null &&
                  nowMinute >= day.openMinute &&
                  nowMinute <= day.closeMinute && (
                    <div className="now-line" style={{ top: minuteToY(nowMinute, win) }} />
                  )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
