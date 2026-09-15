'use client';

import { useState } from 'react';
import type { AgendaBooking, AgendaCourt } from '@/lib/api';
import { formatMinute } from '@/lib/grid';

interface Props {
  booking: AgendaBooking;
  courts: AgendaCourt[];
  onClose: () => void;
  onMove: (id: string, courtId: string, startMinute: number) => Promise<{ ok: boolean; message: string }>;
}

/**
 * Mover un turno a otra cancha y/u horario.
 *
 * El backend y el store (`agendaStore.moveBooking`) ya existían completos
 * — validación de conflictos, actualización optimista, reversión si el
 * servidor rechaza — pero no había ningún control en la interfaz que lo
 * llamara. Sin esto, "mover una reserva" significaba cancelarla y crear
 * una nueva a mano, perdiendo el vínculo con el turno original.
 *
 * Deliberadamente simple (cancha + hora, sin arrastrar bloques en una
 * grilla): la reserva puede estar en cualquiera de las 3-6 canchas del
 * club, así que un selector + una hora cubre el caso real más rápido que
 * dibujar y mantener una grilla de arrastre para esto solo.
 */
export function MoveBookingDialog({ booking, courts, onClose, onMove }: Props) {
  const [courtId, setCourtId] = useState(booking.courtId);
  const [time, setTime] = useState(formatMinute(booking.startMinute));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hh, mm] = time.split(':').map(Number);
  const startMinute = (hh || 0) * 60 + (mm || 0);
  const endMinute = startMinute + booking.durationMinutes;
  const sameSlot = courtId === booking.courtId && startMinute === booking.startMinute;

  async function confirm() {
    setSaving(true);
    setError(null);
    const res = await onMove(booking.id, courtId, startMinute);
    setSaving(false);
    if (res.ok) onClose();
    else setError(res.message);
  }

  return (
    <>
      <div className="nb-dialog-backdrop" onClick={onClose} />
      <div className="nb-dialog" role="dialog" aria-label="Mover turno">
        <div className="nb-dialog-head">
          <div>
            <h3>Mover turno</h3>
            <p className="nb-dialog-sub">{booking.title}</p>
          </div>
          <button className="nb-icon-btn" onClick={onClose} aria-label="Cerrar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="nb-dialog-body">
          <label className="field-label" htmlFor="move-court">Cancha</label>
          <select
            id="move-court"
            className="input"
            value={courtId}
            onChange={(e) => setCourtId(e.target.value)}
          >
            {courts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <label className="field-label" htmlFor="move-time">Hora de inicio</label>
          <input
            id="move-time"
            type="time"
            className="input"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          <p className="nb-dialog-hint">
            Queda de {formatMinute(startMinute)} a {formatMinute(endMinute)}
            {' '}({booking.durationMinutes} min, sin cambios).
          </p>

          {error && <p className="nb-dialog-error">{error}</p>}
        </div>

        <div className="nb-dialog-foot">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={confirm} disabled={saving || sameSlot}>
            {saving ? 'Moviendo…' : 'Mover turno'}
          </button>
        </div>
      </div>
    </>
  );
}
