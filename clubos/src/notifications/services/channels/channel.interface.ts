/**
 * Contrato de un canal de envío (WhatsApp, email, push…).
 *
 * La capa de notificaciones no sabe QUÉ proveedor manda el mensaje: le pide a
 * un canal que lo entregue. Cambiar de proveedor de WhatsApp (Meta directo →
 * 360dialog → Twilio) es cambiar una implementación de esta interfaz, sin
 * tocar el resto del sistema.
 */

export type ChannelKind = 'WHATSAPP' | 'EMAIL' | 'PUSH' | 'SMS';

export interface OutboundMessage {
  /** Destino ya resuelto: teléfono E.164 para WhatsApp/SMS, email para EMAIL. */
  to: string;
  /** Asunto (solo email; los demás lo ignoran). */
  subject?: string;
  /** Cuerpo en texto plano. */
  body: string;
  /** Cuerpo HTML opcional (email). */
  html?: string;
  /** Nombre de plantilla aprobada (WhatsApp exige plantilla fuera de sesión). */
  templateName?: string;
  /** Variables de la plantilla, en orden. */
  templateParams?: string[];
}

export interface SendResult {
  ok: boolean;
  /** Id del mensaje en el proveedor, si lo devuelve. Sirve para trazabilidad. */
  providerMessageId?: string;
  /** Motivo del fallo (para guardar en Notification.error). */
  error?: string;
  /**
   * Si el fallo es transitorio (timeout, 5xx, rate limit): reintentar.
   * Si es permanente (número inválido, plantilla inexistente): no reintentar.
   */
  retryable?: boolean;
}

export interface NotificationChannel {
  readonly kind: ChannelKind;
  /** ¿Está configurado y operativo? (credenciales presentes, etc.) */
  isConfigured(): boolean;
  send(msg: OutboundMessage): Promise<SendResult>;
}
