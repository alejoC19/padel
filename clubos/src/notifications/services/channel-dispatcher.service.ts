import { Injectable } from '@nestjs/common';
import type {
  ChannelKind,
  NotificationChannel,
  OutboundMessage,
  SendResult,
} from './channels/channel.interface';
import { WhatsappChannel } from './channels/whatsapp.channel';
import { EmailChannel } from './channels/email.channel';

/**
 * Enruta un mensaje al canal correcto. Único lugar que conoce todos los
 * canales; el worker le pide "mandá esto por WHATSAPP" y no sabe cómo.
 */
@Injectable()
export class ChannelDispatcher {
  private readonly channels: Map<ChannelKind, NotificationChannel>;

  constructor(whatsapp: WhatsappChannel, email: EmailChannel) {
    this.channels = new Map<ChannelKind, NotificationChannel>([
      [whatsapp.kind, whatsapp],
      [email.kind, email],
    ]);
  }

  isConfigured(kind: ChannelKind): boolean {
    return this.channels.get(kind)?.isConfigured() ?? false;
  }

  async send(kind: ChannelKind, msg: OutboundMessage): Promise<SendResult> {
    const channel = this.channels.get(kind);
    if (!channel) {
      return { ok: false, error: `Canal ${kind} no soportado`, retryable: false };
    }
    return channel.send(msg);
  }
}
