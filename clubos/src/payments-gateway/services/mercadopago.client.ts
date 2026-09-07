import {
  BadGatewayException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Cliente HTTP de Mercado Pago.
 *
 * Encapsula TODA la comunicación con la API de MP para que el resto del
 * sistema no sepa de URLs ni headers de un tercero. Si mañana cambia la API
 * de MP, o se agrega Stripe, se toca solo acá.
 *
 * No usa el SDK oficial a propósito: es fetch nativo (Node 18+). Menos
 * dependencias, control total sobre timeouts y errores, y nada de estado
 * global de credenciales (cada request lleva el token del club que cobra).
 */
@Injectable()
export class MercadoPagoClient {
  private readonly log = new Logger(MercadoPagoClient.name);
  private readonly apiBase = 'https://api.mercadopago.com';
  private readonly authBase = 'https://auth.mercadopago.com.ar';

  constructor(private readonly config: ConfigService) {}

  private appId(): string {
    return this.req('MP_APP_ID');
  }
  private appSecret(): string {
    return this.req('MP_APP_SECRET');
  }
  private req(key: string): string {
    const v = this.config.get<string>(key);
    if (!v) throw new BadGatewayException(`Falta configurar ${key}.`);
    return v;
  }

  // -------------------------------------------------------------------------
  // OAUTH — el club conecta su cuenta
  // -------------------------------------------------------------------------

  /**
   * URL a la que se manda al dueño del club para autorizar la conexión.
   * `state` viaja de ida y vuelta: lo usamos para saber qué club conectó
   * (y para prevenir CSRF: se valida contra un valor firmado).
   */
  buildAuthorizationUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.appId(),
      response_type: 'code',
      platform_id: 'mp',
      redirect_uri: redirectUri,
      state,
    });
    return `${this.authBase}/authorization?${params.toString()}`;
  }

  /** Canjea el `code` del callback por los tokens de la cuenta del club. */
  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<MpOAuthTokens> {
    const res = await this.post('/oauth/token', {
      client_id: this.appId(),
      client_secret: this.appSecret(),
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    return this.asTokens(res);
  }

  /** Renueva el access token antes de que venza, usando el refresh token. */
  async refreshAccessToken(refreshToken: string): Promise<MpOAuthTokens> {
    const res = await this.post('/oauth/token', {
      client_id: this.appId(),
      client_secret: this.appSecret(),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return this.asTokens(res);
  }

  // -------------------------------------------------------------------------
  // CHECKOUT PRO — crear la preferencia de pago
  // -------------------------------------------------------------------------

  /**
   * Crea una preferencia de pago en la cuenta del club (usa SU access token).
   * Devuelve el init_point: la URL a la que se redirige al jugador.
   */
  async createPreference(
    clubAccessToken: string,
    input: CreatePreferenceInput,
  ): Promise<MpPreference> {
    const body = {
      items: [
        {
          id: input.externalReference,
          title: input.concept,
          quantity: 1,
          unit_price: input.amount,
          currency_id: input.currency ?? 'ARS',
        },
      ],
      external_reference: input.externalReference,
      notification_url: input.notificationUrl,
      back_urls: {
        success: input.backUrls.success,
        pending: input.backUrls.pending,
        failure: input.backUrls.failure,
      },
      auto_return: 'approved',
      // El pago expira si no se completa: no queremos reservas bloqueadas
      // por órdenes fantasma.
      expires: true,
      expiration_date_to: input.expiresAt?.toISOString(),
      metadata: {
        club_id: input.clubId,
        booking_id: input.bookingId ?? null,
        sale_id: input.saleId ?? null,
      },
    };

    const res = await this.post('/checkout/preferences', body, clubAccessToken);
    return {
      preferenceId: String(res.id),
      initPoint: String(res.init_point ?? res.sandbox_init_point ?? ''),
    };
  }

  /** Consulta el estado real de un pago (fuente de verdad tras el webhook). */
  async getPayment(
    clubAccessToken: string,
    paymentId: string,
  ): Promise<MpPayment> {
    const res = await this.get(`/v1/payments/${paymentId}`, clubAccessToken);
    return {
      id: String(res.id),
      status: String(res.status), // approved | rejected | pending | in_process | refunded
      statusDetail: res.status_detail ? String(res.status_detail) : null,
      externalReference: res.external_reference
        ? String(res.external_reference)
        : null,
      amount: Number(res.transaction_amount ?? 0),
      raw: res,
    };
  }

  /** Reembolso total o parcial de un pago en la cuenta del club. */
  async refund(
    clubAccessToken: string,
    paymentId: string,
    amount?: number,
  ): Promise<void> {
    const body = amount != null ? { amount } : {};
    await this.post(
      `/v1/payments/${paymentId}/refunds`,
      body,
      clubAccessToken,
    );
  }

  // -------------------------------------------------------------------------
  // WEBHOOK — verificación de firma
  // -------------------------------------------------------------------------

  /**
   * Verifica la firma del header `x-signature` de MP.
   *
   * MP firma con HMAC-SHA256 un template:  id:<dataId>;request-id:<xRequestId>;ts:<ts>;
   * Si no coincide, el webhook es falso o fue alterado: se descarta.
   *
   * Se usa comparación en tiempo constante (timingSafeEqual) para no filtrar
   * información por el tiempo de respuesta.
   */
  verifyWebhookSignature(input: {
    xSignature: string;
    xRequestId: string;
    dataId: string;
    secret: string;
  }): boolean {
    const parts = this.parseSignatureHeader(input.xSignature);
    if (!parts.ts || !parts.v1) return false;

    const manifest = `id:${input.dataId};request-id:${input.xRequestId};ts:${parts.ts};`;
    const expected = createHmac('sha256', input.secret)
      .update(manifest)
      .digest('hex');

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(parts.v1, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private parseSignatureHeader(header: string): { ts?: string; v1?: string } {
    // Formato: "ts=1704908010,v1=abc123..."
    const out: { ts?: string; v1?: string } = {};
    for (const seg of header.split(',')) {
      const [k, v] = seg.split('=').map((s) => s?.trim());
      if (k === 'ts') out.ts = v;
      if (k === 'v1') out.v1 = v;
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // HTTP helpers
  // -------------------------------------------------------------------------

  private async post(
    path: string,
    body: unknown,
    bearer?: string,
  ): Promise<Record<string, unknown>> {
    return this.request('POST', path, body, bearer);
  }
  private async get(
    path: string,
    bearer?: string,
  ): Promise<Record<string, unknown>> {
    return this.request('GET', path, undefined, bearer);
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    bearer?: string,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(`${this.apiBase}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      const json = text ? JSON.parse(text) : {};

      if (res.status === 401) {
        throw new UnauthorizedException(
          'Mercado Pago rechazó las credenciales (token vencido o revocado).',
        );
      }
      if (!res.ok) {
        this.log.warn(`MP ${method} ${path} → ${res.status}: ${text}`);
        throw new BadGatewayException(
          `Mercado Pago respondió ${res.status}.`,
        );
      }
      return json;
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof BadGatewayException) {
        throw err;
      }
      this.log.error(`MP ${method} ${path} falló: ${(err as Error).message}`);
      throw new BadGatewayException('No se pudo contactar a Mercado Pago.');
    } finally {
      clearTimeout(timeout);
    }
  }

  private asTokens(res: Record<string, unknown>): MpOAuthTokens {
    return {
      accessToken: String(res.access_token),
      refreshToken: String(res.refresh_token),
      publicKey: res.public_key ? String(res.public_key) : null,
      userId: res.user_id != null ? String(res.user_id) : null,
      expiresInSec: Number(res.expires_in ?? 0),
      scope: res.scope ? String(res.scope) : null,
    };
  }
}

// ---------------------------------------------------------------------------
// Tipos del contrato con MP
// ---------------------------------------------------------------------------

export interface MpOAuthTokens {
  accessToken: string;
  refreshToken: string;
  publicKey: string | null;
  userId: string | null;
  expiresInSec: number;
  scope: string | null;
}

export interface CreatePreferenceInput {
  clubId: string;
  externalReference: string;
  concept: string;
  amount: number;
  currency?: string;
  notificationUrl: string;
  backUrls: { success: string; pending: string; failure: string };
  expiresAt?: Date | null;
  bookingId?: string | null;
  saleId?: string | null;
}

export interface MpPreference {
  preferenceId: string;
  initPoint: string;
}

export interface MpPayment {
  id: string;
  status: string;
  statusDetail: string | null;
  externalReference: string | null;
  amount: number;
  raw: Record<string, unknown>;
}
