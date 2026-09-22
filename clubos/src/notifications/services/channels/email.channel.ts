import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type {
  NotificationChannel,
  OutboundMessage,
  SendResult,
} from './channel.interface';

/**
 * Canal de email transaccional vía SMTP (pensado para Gmail con una
 * "contraseña de aplicación", pero sirve para cualquier proveedor SMTP —
 * solo cambian host/puerto).
 *
 * Para comprobantes y confirmaciones, no para marketing masivo.
 */
@Injectable()
export class EmailChannel implements NotificationChannel, OnModuleDestroy {
  readonly kind = 'EMAIL' as const;
  private readonly log = new Logger(EmailChannel.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get('SMTP_HOST') &&
        this.config.get('SMTP_USER') &&
        this.config.get('SMTP_PASS') &&
        this.config.get('EMAIL_FROM'),
    );
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!this.isConfigured()) {
      return { ok: false, error: 'Email no configurado', retryable: false };
    }
    if (!/\S+@\S+\.\S+/.test(msg.to)) {
      return { ok: false, error: 'Email destino inválido', retryable: false };
    }

    const from = this.config.get<string>('EMAIL_FROM');

    try {
      const info = await this.getTransporter().sendMail({
        from,
        to: msg.to,
        subject: msg.subject ?? 'ClubOS',
        text: msg.body,
        html: msg.html ?? this.textToHtml(msg.body),
      });

      return { ok: true, providerMessageId: info.messageId };
    } catch (err) {
      // SMTP invierte la semántica de HTTP: 4xx es temporario (reintentar),
      // 5xx es permanente (rechazo del server, no se arregla reintentando).
      // Sin código (timeout/conexión) también vale reintentar.
      const code = (err as { responseCode?: number }).responseCode;
      const retryable = !code || code < 500;
      this.log.warn(`SMTP error enviando a ${msg.to}: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message, retryable };
    }
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    this.transporter = createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: Number(this.config.get('SMTP_PORT') ?? 465),
      secure: Number(this.config.get('SMTP_PORT') ?? 465) === 465,
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });
    return this.transporter;
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

  onModuleDestroy(): void {
    this.transporter?.close();
  }
}
