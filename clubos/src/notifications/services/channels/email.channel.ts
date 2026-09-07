import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  NotificationChannel,
  OutboundMessage,
  SendResult,
} from './channel.interface';

/**
 * Canal de email transaccional vía Resend (https://resend.com).
 *
 * Se eligió Resend por API simple y buen free tier, pero la interfaz es
 * idéntica para SendGrid/Postmark: cambia la URL y el shape del body.
 * Para comprobantes y confirmaciones, no para marketing masivo.
 */
@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly kind = 'EMAIL' as const;
  private readonly log = new Logger(EmailChannel.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get('RESEND_API_KEY') && this.config.get('EMAIL_FROM'),
    );
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!this.isConfigured()) {
      return { ok: false, error: 'Email no configurado', retryable: false };
    }
    if (!/\S+@\S+\.\S+/.test(msg.to)) {
      return { ok: false, error: 'Email destino inválido', retryable: false };
    }

    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('EMAIL_FROM');

    try {
      const res = await this.fetchWithTimeout('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [msg.to],
          subject: msg.subject ?? 'ClubOS',
          text: msg.body,
          html: msg.html ?? this.textToHtml(msg.body),
        }),
      });

      const text = await res.text();
      const json = text ? JSON.parse(text) : {};

      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        this.log.warn(`Resend ${res.status}: ${text}`);
        return {
          ok: false,
          error: json?.message ?? `HTTP ${res.status}`,
          retryable,
        };
      }

      return { ok: true, providerMessageId: json?.id };
    } catch (err) {
      return { ok: false, error: (err as Error).message, retryable: true };
    }
  }

  private textToHtml(text: string): string {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#2b3a47">${escaped.replace(
      /\n/g,
      '<br>',
    )}</div>`;
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12_000);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
  }
}
