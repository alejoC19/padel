import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';
import { resolve4 } from 'node:dns/promises';
import { createTransport } from 'nodemailer';
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
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ SE RESUELVE LA IP A MANO (y solo IPv4)
 * ---------------------------------------------------------------------------
 * La resolución DNS interna de nodemailer 10.x elige al azar entre las
 * direcciones IPv4 e IPv6 del host. Railway (y muchos contenedores) reportan
 * una interfaz IPv6 local pero no tienen salida IPv6 real a internet — cuando
 * toca una IPv6 de smtp.gmail.com, la conexión falla con ENETUNREACH. Como no
 * hay forma de forzar solo-IPv4 vía las opciones públicas del transport en
 * esta versión, se resuelve el host a IPv4 antes de conectar y se pasa esa IP
 * como `host`, con `servername` seteado al hostname original para que el TLS
 * (SNI y validación del certificado) siga validando contra "smtp.gmail.com"
 * y no contra la IP.
 * ---------------------------------------------------------------------------
 */
@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly kind = 'EMAIL' as const;
  private readonly log = new Logger(EmailChannel.name);

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
      const transporter = await this.buildTransporter();
      const info = await transporter.sendMail({
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

  // No hay pool (`pool: true`) acá: nodemailer abre una conexión por
  // sendMail() de todas formas, así que crear el transport en cada envío no
  // suma overhead, y a cambio la IP resuelta nunca queda vieja si el
  // proveedor rota sus direcciones.
  private async buildTransporter() {
    const host = this.config.get<string>('SMTP_HOST')!;
    const resolvedHost = await this.resolveIPv4(host);

    return createTransport({
      host: resolvedHost,
      servername: host,
      port: Number(this.config.get('SMTP_PORT') ?? 465),
      secure: Number(this.config.get('SMTP_PORT') ?? 465) === 465,
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });
  }

  private async resolveIPv4(host: string): Promise<string> {
    if (isIP(host)) return host; // ya es una IP, nada que resolver.
    try {
      const [ip] = await resolve4(host);
      return ip ?? host;
    } catch {
      // Sin registro A o falló la resolución: dejamos que nodemailer lo
      // intente con el hostname tal cual, mejor que romper el envío acá.
      return host;
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
