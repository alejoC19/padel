import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  NotificationChannel,
  OutboundMessage,
  SendResult,
} from './channel.interface';

/**
 * Canal WhatsApp vía Meta Cloud API.
 *
 * Notas de WhatsApp Business que condicionan el diseño:
 *  - Fuera de la "ventana de 24h" (cuando el cliente no escribió primero) solo
 *    se pueden mandar PLANTILLAS pre-aprobadas por Meta. Por eso los envíos
 *    salientes del club (confirmación, recordatorio) usan `templateName`.
 *  - El número va en formato E.164 sin '+' (ej: 5491155550000).
 *
 * Si preferís no pelear con la aprobación de Meta al inicio, esta misma
 * interfaz la implementa un intermediario (360dialog, Wati, Gupshup):
 * se cambia la URL y el formato del body, nada más.
 */
@Injectable()
export class WhatsappChannel implements NotificationChannel {
  readonly kind = 'WHATSAPP' as const;
  private readonly log = new Logger(WhatsappChannel.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get('WHATSAPP_PHONE_NUMBER_ID') &&
        this.config.get('WHATSAPP_ACCESS_TOKEN'),
    );
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!this.isConfigured()) {
      return { ok: false, error: 'WhatsApp no configurado', retryable: false };
    }

    const phoneId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const token = this.config.get<string>('WHATSAPP_ACCESS_TOKEN');
    const lang = this.config.get<string>('WHATSAPP_TEMPLATE_LANG') ?? 'es_AR';
    const to = this.normalizePhone(msg.to);

    if (!to) {
      return { ok: false, error: 'Teléfono inválido', retryable: false };
    }

    // Con plantilla (caso normal para mensajes salientes del club).
    const payload = msg.templateName
      ? {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: msg.templateName,
            language: { code: lang },
            components: msg.templateParams?.length
              ? [
                  {
                    type: 'body',
                    parameters: msg.templateParams.map((t) => ({
                      type: 'text',
                      text: t,
                    })),
                  },
                ]
              : undefined,
          },
        }
      : {
          // Texto libre: solo funciona dentro de la ventana de 24h.
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: msg.body },
        };

    try {
      const res = await this.fetchWithTimeout(
        `https://graph.facebook.com/v20.0/${phoneId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      const text = await res.text();
      const json = text ? JSON.parse(text) : {};

      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        this.log.warn(`WhatsApp ${res.status}: ${text}`);
        return {
          ok: false,
          error: json?.error?.message ?? `HTTP ${res.status}`,
          retryable,
        };
      }

      return {
        ok: true,
        providerMessageId: json?.messages?.[0]?.id,
      };
    } catch (err) {
      // Timeout / red: transitorio, reintentar.
      return { ok: false, error: (err as Error).message, retryable: true };
    }
  }

  /** A E.164 sin '+'. Asume AR si viene sin código de país. */
  private normalizePhone(raw: string): string | null {
    let d = raw.replace(/[^\d]/g, '');
    if (!d) return null;
    if (d.startsWith('54')) return d;
    if (d.startsWith('0')) d = d.slice(1);
    // Móvil argentino: 54 9 + área + número
    return `549${d}`;
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
