'use client';

import { useState } from 'react';
import { formatMinute } from '@/lib/grid';
import { ClientSearch } from '@/components/ClientSearch';
import type { ClientSearchResult } from '@/lib/api';

interface Props {
  courtId: string;
  courtName: string;
  startMinute: number;
  slotMinutes: number;
  onClose: () => void;
  onCreate: (input: {
    courtId: string;
    startMinute: number;
    durationMinutes: number;
    clientId?: string;
    playersCount?: number;
  }) => Promise<{ ok: boolean; message: string }>;
}

/**
 * Diálogo para crear una reserva desde el panel del club.
 *
 * Conecta el clic en un espacio vacío de la agenda con la creación real de la
 * reserva. El staff elige duración, opcionalmente un cliente y la cantidad de
 * jugadores, y confirma. La reserva se crea contra el backend.
 */
export function NewBookingDialog({
  courtId, courtName, startMinute, slotMinutes, onClose, onCreate,
}: Props) {
  const [duration, setDuration] = useState(slotMinutes >= 60 ? slotMinutes : 90);
  const [client, setClient] = useState<ClientSearchResult | null>(null);
  const [players, setPlayers] = useState(4);
  const [searchOpen, setSearchOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const durations = [60, 90, 120];
  const endMinute = startMinute + duration;

  async function confirm() {
    setSaving(true);
    setError(null);
    const res = await onCreate({
      courtId,
      startMinute,
      durationMinutes: duration,
      clientId: client?.id,
      playersCount: players,
    });
    setSaving(false);
    if (res.ok) {
      onClose();
    } else {
      setError(res.message);
    }
  }

  return (
    <>
      <div className="dialog-backdrop" onClick={onClose} />
      <div className="dialog" role="dialog" aria-label="Nueva reserva">
        <div className="dialog-head">
          <div>
            <h3>Nueva reserva</h3>
            <p className="dialog-sub">
              {courtName} · {formatMinute(startMinute)}–{formatMinute(endMinute)}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="dialog-body">
          <label className="field-label">Duración</label>
          <div className="seg">
            {durations.map((d) => (
              <button
                key={d}
                className={`seg-btn ${duration === d ? 'on' : ''}`}
                onClick={() => setDuration(d)}
              >
                {d} min
              </button>
            ))}
          </div>

          <label className="field-label">Cliente</label>
          {client ? (
            <div className="picked-client">
              <span>{client.firstName} {client.lastName}</span>
              <button className="link-btn" onClick={() => setClient(null)}>Quitar</button>
            </div>
          ) : (
            <button className="btn btn-secondary full" onClick={() => setSearchOpen(true)}>
              Buscar cliente (opcional)
            </button>
          )}

          <label className="field-label">Jugadores</label>
          <div className="seg">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                className={`seg-btn ${players === n ? 'on' : ''}`}
                onClick={() => setPlayers(n)}
              >
                {n}
              </button>
            ))}
          </div>

          {error && <p className="dialog-error">{error}</p>}
        </div>

        <div className="dialog-foot">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={confirm} disabled={saving}>
            {saving ? 'Creando…' : 'Crear reserva'}
          </button>
        </div>
      </div>

      <ClientSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPick={(c) => { setClient(c); setSearchOpen(false); }}
      />
    </>
  );
}
