'use client';

import { useMemo } from 'react';
import type { AgendaDay } from '@/lib/api';
import { currentMinuteOfDay, formatMinute, isToday } from '@/lib/grid';

interface Props {
  day: AgendaDay;
  selectedCourtId: string;
  onSelectCourt: (courtId: string) => void;
}

/**
 * "¿Qué cancha está libre AHORA?" en una sola mirada.
 *
 * Antes, la única forma de saber si una cancha estaba ocupada era abrirla
 * una por una en el selector de AgendaBoard — para un club de 4 canchas,
 * eso son 4 clics para armarse una idea que debería tomar un vistazo. Esta
 * tira no reemplaza el detalle (sigue viviendo en AgendaBoard, con hora y
 * quién reservó); es el resumen de arriba que responde la pregunta más
 * frecuente de un mostrador: "¿tengo alguna cancha libre en este momento?"
 *
 * No pega al backend de nuevo: se calcula sobre los mismos `day.bookings`
 * que ya carga AgendaScreen.
 */
export function CourtOverviewStrip({ day, selectedCourtId, onSelectCourt }: Props) {
  // "¿Libre AHORA?" solo tiene sentido mirando el día de hoy — en otro día,
  // comparar sus turnos contra la hora actual del reloj los marca ocupados
  // o libres al azar según a qué hora del día de hoy coincidan.
  const today = isToday(day.date);
  const now = today ? currentMinuteOfDay(day.timezone) : -1;

  const rows = useMemo(() => {
    return day.courts.map((court) => {
      const current = today && day.bookings.find((b) => (
        b.courtId === court.id
        && b.startMinute <= now && now < b.endMinute
        && b.status !== 'CANCELLED_BY_CLIENT' && b.status !== 'CANCELLED_BY_CLUB'
      ));
      const upcoming = !current
        ? day.bookings
          .filter((b) => (
            b.courtId === court.id
            && (!today || b.startMinute > now)
            && b.status !== 'CANCELLED_BY_CLIENT' && b.status !== 'CANCELLED_BY_CLUB'
          ))
          .sort((a, b) => a.startMinute - b.startMinute)[0]
        : undefined;

      return { court, current, upcoming };
    });
  }, [day, now, today]);

  return (
    <div className="court-strip" role="tablist" aria-label="Estado de las canchas ahora">
      {rows.map(({ court, current, upcoming }) => {
        const isBlock = current && ['MAINTENANCE', 'EVENT', 'ADMIN_BLOCK'].includes(current.type);
        const status = current
          ? (isBlock ? 'Bloqueada' : `Ocupada · ${formatMinute(current.endMinute)}`)
          : upcoming
            ? `Libre · hasta las ${formatMinute(upcoming.startMinute)}`
            : 'Libre todo el día';
        const tone = current ? (isBlock ? 'block' : 'busy') : 'free';

        return (
          <button
            key={court.id}
            role="tab"
            aria-selected={court.id === selectedCourtId}
            className={`court-chip-lg is-${tone}${court.id === selectedCourtId ? ' is-selected' : ''}`}
            onClick={() => onSelectCourt(court.id)}
          >
            <span className="court-chip-lg-dot" style={{ background: court.color }} />
            <span className="court-chip-lg-body">
              <span className="court-chip-lg-name">{court.name}</span>
              <span className="court-chip-lg-status">{status}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
