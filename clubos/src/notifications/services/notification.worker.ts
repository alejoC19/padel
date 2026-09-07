import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithoutTenancy } from '../../tenancy/tenant-context';
import { ChannelDispatcher } from './channel-dispatcher.service';
import type { ChannelKind } from './channels/channel.interface';

/**
 * Worker que vacía la cola de notificaciones.
 *
 * Corre periódicamente, toma un lote de filas PENDING (de TODOS los clubes),
 * intenta entregarlas y marca el resultado. No hay proceso aparte: es un cron
 * dentro de la API. Suficiente para el volumen de clubes de pádel.
 *
 * ---------------------------------------------------------------------------
 * TENANCY
 * ---------------------------------------------------------------------------
 * `Notification` está bajo RLS (tiene clubId). El worker procesa varios clubes
 * a la vez, así que corre bajo `runWithoutTenancy`: es un job de plataforma,
 * el equivalente a un cron de sistema. Es el escape hatch legítimo para esto.
 *
 * CONCURRENCIA: si hubiera dos instancias de la API, ambas correrían el cron.
 * Para evitar doble envío, el claim del lote usa un UPDATE condicional
 * (PENDING → SENDING) que solo una gana. Con una sola instancia igual funciona.
 * ---------------------------------------------------------------------------
 */
@Injectable()
export class NotificationWorker {
  private readonly log = new Logger(NotificationWorker.name);
  private running = false;

  private static readonly BATCH = 25;
  private static readonly MAX_RETRIES = 4;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: ChannelDispatcher,
  ) {}

  /** Cada minuto. Los recordatorios no necesitan latencia de segundos. */
  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    // Evita solaparse consigo mismo si un lote tarda más de un minuto.
    if (this.running) return;
    this.running = true;
    try {
      await runWithoutTenancy(randomUUID(), () => this.drain());
    } catch (err) {
      this.log.error(`Fallo procesando la cola: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<void> {
    // CLAIM ATÓMICO del lote.
    //
    // Se marcan hasta BATCH filas PENDING como 'SENT' de forma atómica y se
    // recuperan sus ids (UPDATE ... RETURNING). Solo una instancia del worker
    // puede ganar cada fila: si hubiera dos APIs corriendo el cron, no se
    // duplican envíos. Las filas quedan 'SENT' de forma optimista; si el envío
    // falla, deliver() las revierte a PENDING (para reintentar) o a FAILED.
    //
    // sentAt marca el claim; el envío real lo confirma o lo revierte.
    //
    // TRADE-OFF (at-most-once): si el proceso muere entre el claim y el envío,
    // la fila queda 'SENT' sin haberse mandado. A este volumen es aceptable;
    // si se vuelve crítico, agregar un estado 'SENDING' intermedio + un barrido
    // que reponga a PENDING las 'SENDING' viejas (más de N minutos).
    const claimed = await this.prisma.$queryRaw<
      Array<{
        id: string;
        channel: string;
        title: string;
        body: string;
        metadata: unknown;
        retry_count: number;
      }>
    >`
      UPDATE notifications
      SET status = 'SENT', "sentAt" = now()
      WHERE id IN (
        SELECT id FROM notifications
        WHERE status = 'PENDING'
        ORDER BY "createdAt" ASC
        LIMIT ${NotificationWorker.BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, channel, title, body, metadata, "retryCount" AS retry_count
    `;

    if (!claimed || claimed.length === 0) return;

    for (const n of claimed) {
      await this.deliver({
        id: n.id,
        channel: n.channel,
        title: n.title,
        body: n.body,
        metadata: n.metadata,
        retryCount: n.retry_count,
      });
    }
  }

  private async deliver(n: {
    id: string;
    channel: string;
    title: string;
    body: string;
    metadata: unknown;
    retryCount: number;
  }): Promise<void> {
    const meta = (n.metadata ?? {}) as Record<string, unknown>;
    const to = String(meta.to ?? '');
    const kind = n.channel as ChannelKind;

    if (!to || !this.dispatcher.isConfigured(kind)) {
      // Sin destino o canal no configurado: no reintentar, marcar fallo.
      await this.markFailed(
        n.id,
        !to ? 'Sin destino' : `Canal ${kind} no configurado`,
      );
      return;
    }

    const result = await this.dispatcher.send(kind, {
      to,
      subject: typeof meta.subject === 'string' ? meta.subject : n.title,
      body: n.body,
      templateName:
        typeof meta.waTemplate === 'string' ? meta.waTemplate : undefined,
      templateParams: Array.isArray(meta.waParams)
        ? (meta.waParams as string[])
        : undefined,
    });

    if (result.ok) {
      // Ya está en SENT por el claim; solo se confirma con el id del proveedor.
      await this.prisma.$transaction(async (tx) => {
        await tx.notification.update({
          where: { id: n.id },
          data: {
            providerMessageId: result.providerMessageId ?? null,
            error: null,
          },
        });
      });
      return;
    }

    // Falló. ¿Reintentable y con reintentos disponibles?
    const canRetry =
      result.retryable !== false && n.retryCount < NotificationWorker.MAX_RETRIES;

    if (canRetry) {
      // Revertir a PENDING para que el próximo tick lo reintente.
      await this.prisma.$transaction(async (tx) => {
        await tx.notification.update({
          where: { id: n.id },
          data: {
            status: 'PENDING',
            sentAt: null,
            retryCount: { increment: 1 },
            error: result.error ?? 'Error transitorio',
          },
        });
      });
      this.log.warn(
        `Notificación ${n.id} reintentará (intento ${n.retryCount + 1}): ${result.error}`,
      );
    } else {
      await this.markFailed(n.id, result.error ?? 'Error permanente');
    }
  }

  private async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.notification.update({
        where: { id },
        data: { status: 'FAILED', error: error.slice(0, 500) },
      });
    });
  }
}
