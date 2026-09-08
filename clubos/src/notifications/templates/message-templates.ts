/**
 * Plantillas de mensajes por tipo de notificación.
 *
 * Cada plantilla arma el texto (y, para WhatsApp, el nombre de la plantilla
 * aprobada + sus parámetros en orden). Mantener el contenido acá, separado del
 * envío, permite ajustar el copy sin tocar la lógica de la cola ni los canales.
 *
 * IMPORTANTE (WhatsApp): los `waTemplate` deben coincidir EXACTAMENTE con
 * plantillas aprobadas en el panel de Meta, y el orden de `waParams` con el
 * orden de las variables {{1}}, {{2}}… de esa plantilla. Cambiar el texto acá
 * NO cambia lo aprobado en Meta.
 */

export interface RenderedMessage {
  subject: string;
  body: string;
  waTemplate?: string;
  waParams?: string[];
}

export interface BookingData {
  clubName: string;
  clientName: string;
  courtName: string;
  date: string; // ya formateado, ej "sáb 2 de agosto"
  time: string; // ej "19:00"
  code: string;
}

function fmtBooking(clubName: string, court: string, date: string, time: string) {
  return `${court} · ${date} a las ${time}`;
}

export const templates = {
  BOOKING_CONFIRMED(d: BookingData): RenderedMessage {
    return {
      subject: `Reserva confirmada — ${d.clubName}`,
      body:
        `¡Hola ${d.clientName}! Tu reserva en ${d.clubName} quedó confirmada.\n\n` +
        `${fmtBooking(d.clubName, d.courtName, d.date, d.time)}\n` +
        `Código: ${d.code}\n\n` +
        `¡Te esperamos! 🎾`,
      waTemplate: 'booking_confirmed',
      waParams: [d.clientName, d.courtName, d.date, d.time, d.code],
    };
  },

  BOOKING_REMINDER(d: BookingData): RenderedMessage {
    return {
      subject: `Recordatorio de tu reserva — ${d.clubName}`,
      body:
        `Hola ${d.clientName}, te recordamos tu reserva en ${d.clubName}.\n\n` +
        `${fmtBooking(d.clubName, d.courtName, d.date, d.time)}\n\n` +
        `Si no podés venir, avisanos con tiempo así liberamos el turno. 🙌`,
      waTemplate: 'booking_reminder',
      waParams: [d.clientName, d.courtName, d.date, d.time],
    };
  },

  BOOKING_CANCELLED(d: BookingData): RenderedMessage {
    return {
      subject: `Reserva cancelada — ${d.clubName}`,
      body:
        `Hola ${d.clientName}, tu reserva en ${d.clubName} fue cancelada.\n\n` +
        `${fmtBooking(d.clubName, d.courtName, d.date, d.time)}\n` +
        `Código: ${d.code}\n\n` +
        `Cualquier duda, escribinos.`,
      waTemplate: 'booking_cancelled',
      waParams: [d.clientName, d.courtName, d.date, d.time],
    };
  },

  PAYMENT_RECEIVED(d: BookingData & { amount: string }): RenderedMessage {
    return {
      subject: `Pago recibido — ${d.clubName}`,
      body:
        `¡Gracias ${d.clientName}! Recibimos tu pago de ${d.amount} en ${d.clubName}.\n\n` +
        `Reserva: ${fmtBooking(d.clubName, d.courtName, d.date, d.time)}\n` +
        `Código: ${d.code}`,
      waTemplate: 'payment_received',
      waParams: [d.clientName, d.amount, d.code],
    };
  },

  TOURNAMENT_ENTRY_PAID(d: TournamentEntryData): RenderedMessage {
    return {
      subject: `Inscripción confirmada — ${d.clubName}`,
      body:
        `¡Gracias ${d.clientName}! Tu equipo "${d.teamName}" quedó anotado en ` +
        `${d.tournamentName} (${d.clubName}).\n\n` +
        `Inscripción pagada: ${d.amount}.\n` +
        `¡Nos vemos en la cancha! 🎾`,
      waTemplate: 'tournament_entry_paid',
      waParams: [d.clientName, d.teamName, d.tournamentName, d.amount],
    };
  },
};

export interface TournamentEntryData {
  clubName: string;
  clientName: string;
  tournamentName: string;
  teamName: string;
  amount: string;
}

export type TemplateKey = keyof typeof templates;
