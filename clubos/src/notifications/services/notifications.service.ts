import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, $Enums } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  templates, type BookingData, type TournamentEntryData,
} from '../templates/message-templates';

/**
 * Punto de entrada para EMITIR notificaciones. Nunca envía sincrónico:
 * inserta filas en `Notification` con estado PENDING, y el worker las manda.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ENCOLAR EN LA BASE (y no en memoria / BullMQ todavía)
 * ---------------------------------------------------------------------------
 * Un club de pádel manda decenas o cientos de mensajes por día, no millones.
 * A ese volumen, la tabla `Notification` como cola es más simple de operar
 * (sin proceso worker aparte), sobrevive reinicios (la cola es Postgres, no
 * RAM) y es idempotente por diseño (una fila = un intento de entrega).
 *
 * Cuando el volumen lo justifique, se migra a BullMQ sin cambiar esta interfaz:
 * `enqueue*` seguiría igual, solo cambiaría quién consume las filas PENDING.
 * ---------------------------------------------------------------------------
 *
 * Los métodos aceptan un `tx` opcional: cuando la notificación se emite dentro
 * de la misma transacción que crea la reserva (o confirma el pago), se encola
 * atómicamente con ella. Si la reserva no se guarda, la notificación tampoco.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Confirmación de reserva. Encola WhatsApp + email según los datos de
   * contacto que tenga el cliente. Silencioso si el cliente no tiene ninguno.
   */
  async enqueueBookingConfirmed(
    input: EnqueueBookingInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const rendered = templates.BOOKING_CONFIRMED(input.data);
    await this.enqueue(
      {
        clubId: input.clubId,
        clientId: input.clientId,
        type: 'BOOKING_CONFIRMED',
        title: rendered.subject,
        rendered,
        contact: input.contact,
        actionUrl: input.actionUrl,
        metadata: { bookingCode: input.data.code, waParams: rendered.waParams },
      },
      tx,
    );
  }

  async enqueueBookingReminder(
    input: EnqueueBookingInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const rendered = templates.BOOKING_REMINDER(input.data);
    await this.enqueue(
      {
        clubId: input.clubId,
        clientId: input.clientId,
        type: 'BOOKING_REMINDER',
        title: rendered.subject,
        rendered,
        contact: input.contact,
        actionUrl: input.actionUrl,
        metadata: { bookingCode: input.data.code, waParams: rendered.waParams },
      },
      tx,
    );
  }

  async enqueueBookingCancelled(
    input: EnqueueBookingInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const rendered = templates.BOOKING_CANCELLED(input.data);
    await this.enqueue(
      {
        clubId: input.clubId,
        clientId: input.clientId,
        type: 'BOOKING_CANCELLED',
        title: rendered.subject,
        rendered,
        contact: input.contact,
        actionUrl: input.actionUrl,
        metadata: { bookingCode: input.data.code, waParams: rendered.waParams },
      },
      tx,
    );
  }

  async enqueuePaymentReceived(
    input: EnqueueBookingInput & { amount: string },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const rendered = templates.PAYMENT_RECEIVED({ ...input.data, amount: input.amount });
    await this.enqueue(
      {
        clubId: input.clubId,
        clientId: input.clientId,
        type: 'PAYMENT_RECEIVED',
        title: rendered.subject,
        rendered,
        contact: input.contact,
        actionUrl: input.actionUrl,
        metadata: { bookingCode: input.data.code, amount: input.amount, waParams: rendered.waParams },
      },
      tx,
    );
  }

  /**
   * Crea una fila PENDING por cada canal con destino disponible.
   * WhatsApp si hay teléfono/whatsapp; email si hay email. Una notificación
   * lógica puede volverse 1 o 2 filas (una por canal).
   */
  /**
   * Inscripción a torneo pagada online. Se usa `TOURNAMENT_UPDATE` como tipo
   * (no hay uno dedicado en el enum) — igual que el resto, encola por canal
   * según el contacto disponible.
   */
  async enqueueTournamentEntryPaid(
    input: {
      clubId: string;
      clientId?: string | null;
      contact: ContactInfo;
      data: TournamentEntryData;
      actionUrl?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const rendered = templates.TOURNAMENT_ENTRY_PAID(input.data);
    await this.enqueue(
      {
        clubId: input.clubId,
        clientId: input.clientId,
        type: 'TOURNAMENT_UPDATE',
        title: rendered.subject,
        rendered,
        contact: input.contact,
        actionUrl: input.actionUrl,
        metadata: { teamName: input.data.teamName, waParams: rendered.waParams },
      },
      tx,
    );
  }

  private async enqueue(
    input: EnqueueInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const rows: Prisma.NotificationCreateManyInput[] = [];

    const whatsappTo = input.contact.whatsapp ?? input.contact.phone;
    if (whatsappTo) {
      rows.push({
        clubId: input.clubId,
        clientId: input.clientId ?? null,
        channel: 'WHATSAPP',
        type: input.type,
        title: input.title,
        body: input.rendered.body,
        actionUrl: input.actionUrl ?? null,
        status: 'PENDING',
        metadata: {
          to: whatsappTo,
          waTemplate: input.rendered.waTemplate,
          waParams: input.rendered.waParams ?? [],
        } as Prisma.InputJsonValue,
      });
    }

    if (input.contact.email) {
      rows.push({
        clubId: input.clubId,
        clientId: input.clientId ?? null,
        channel: 'EMAIL',
        type: input.type,
        title: input.title,
        body: input.rendered.body,
        actionUrl: input.actionUrl ?? null,
        status: 'PENDING',
        metadata: {
          to: input.contact.email,
          subject: input.title,
        } as Prisma.InputJsonValue,
      });
    }

    if (rows.length === 0) {
      this.log.debug(
        `Notificación ${input.type} sin canal: el cliente no tiene contacto.`,
      );
      return;
    }

    const client = (tx ?? this.prisma.db) as Prisma.TransactionClient;
    await client.notification.createMany({ data: rows });
  }
}

// ---------------------------------------------------------------------------

export interface ContactInfo {
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
}

export interface EnqueueBookingInput {
  clubId: string;
  clientId?: string | null;
  contact: ContactInfo;
  data: BookingData;
  actionUrl?: string | null;
}

interface EnqueueInput {
  clubId: string;
  clientId?: string | null;
  type: $Enums.NotificationType;
  title: string;
  rendered: { body: string; waTemplate?: string; waParams?: string[] };
  contact: ContactInfo;
  actionUrl?: string | null;
  metadata?: Record<string, unknown>;
}
