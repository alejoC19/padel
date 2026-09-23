import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  NotificationChannel,
  OutboundMessage,
  SendResult,
} from './channel.interface';

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Canal de email transaccional vía la API HTTP de Resend.
 *
 * Para comprobantes y confirmaciones, no para marketing masivo.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ HTTP Y NO SMTP DIRECTO
 * ---------------------------------------------------------------------------
 * La versión anterior mandaba por SMTP directo contra Gmail (con IPv4
 * forzada a mano para esquivar el problema de IPv6 de Railway). Aun así,
 * en producción TODOS los envíos fallaban con "Connection timeout",
 * probado en el puerto 465 y en 587 — la conexión SMTP en sí nunca se
 * completa. Es un problema de red, no de configuración: es conocido que
 * los proveedores de correo (Gmail incluido) suelen ignorar o bloquear
 * conexiones SMTP directas que vienen de rangos de IP de datacenters/
 * cloud como medida antispam, sin importar el puerto.
 *
 * La API HTTP viaja por HTTPS (443), el mismo camino que ya usa el resto
 * del backend para salir a internet — no pega contra ese bloqueo.
 * ---------------------------------------------------------------------------
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
      const res = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: msg.to,
          subject: msg.subject ?? 'ClubOS',
          text: msg.body,
          html: msg.html ?? this.textToHtml(msg.body),
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // Resend usa semántica HTTP normal: 4xx es un pedido roto (dominio
        // no verificado, remitente inválido, payload malo) — reintentar no
        // lo arregla. 429 (rate limit) y 5xx sí valen la pena reintentar.
        const retryable = res.status === 429 || res.status >= 500;
        const error = `Resend ${res.status}: ${body.slice(0, 300)}`;
        this.log.warn(`Error enviando a ${msg.to}: ${error}`);
        return { ok: false, error, retryable };
      }

      const data = (await res.json()) as { id?: string };
      return { ok: true, providerMessageId: data.id };
    } catch (err) {
      // Fetch nunca llegó a completar (red caída, DNS, timeout): reintentar
      // tiene sentido, puede ser un problema transitorio.
      this.log.warn(`Error de red enviando a ${msg.to}: ${(err as Error).message}`);
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
}
