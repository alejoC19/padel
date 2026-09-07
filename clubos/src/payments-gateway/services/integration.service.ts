import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from './crypto.service';
import { MercadoPagoClient } from './mercadopago.client';

/**
 * Gestiona el vínculo OAuth entre un club y su cuenta de Mercado Pago.
 *
 * El dueño del club hace clic en "Conectar Mercado Pago", autoriza en el
 * sitio de MP, y vuelve. A partir de ahí el club puede cobrar reservas
 * online a su propia cuenta. La plataforma solo guarda (cifrados) los tokens.
 */
@Injectable()
export class IntegrationService {
  private readonly log = new Logger(IntegrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly mp: MercadoPagoClient,
  ) {}

  private redirectUri(): string {
    const base = this.config.get<string>('API_PUBLIC_URL');
    if (!base) throw new BadRequestException('Falta API_PUBLIC_URL.');
    return `${base}/payments/mercadopago/oauth/callback`;
  }

  /**
   * Paso 1: genera la URL de autorización.
   *
   * El `state` es HMAC(clubId + nonce) firmado con un secreto del servidor.
   * Al volver el callback, se re-verifica: garantiza que el club que inició
   * el flujo es el mismo que vuelve, y que nadie forjó el parámetro (CSRF).
   */
  async beginConnect(clubId: string): Promise<{ authorizationUrl: string }> {
    // Asegura que existe una fila de integración PENDING para este club.
    await this.prisma.db.clubPaymentIntegration.upsert({
      where: { clubId_provider: { clubId, provider: 'MERCADO_PAGO' } },
      create: { clubId, provider: 'MERCADO_PAGO', status: 'PENDING' },
      update: {},
    });

    const nonce = randomBytes(12).toString('hex');
    const state = this.signState(clubId, nonce);
    const url = this.mp.buildAuthorizationUrl(this.redirectUri(), state);
    return { authorizationUrl: url };
  }

  /**
   * Verifica el `state` del callback y devuelve el clubId, SIN tocar la BD.
   * El controller lo usa para montar el TenantContext antes de escribir
   * (las tablas de integración tienen RLS y exigen club activo).
   */
  resolveClubFromState(state: string): string {
    const clubId = this.verifyState(state);
    if (!clubId) {
      throw new BadRequestException('State inválido o expirado.');
    }
    return clubId;
  }

  /**
   * Paso 2: callback de OAuth. Canjea el code por tokens y los guarda cifrados.
   * Debe ejecutarse DENTRO de un TenantContext con este clubId (lo monta el
   * controller usando resolveClubFromState).
   */
  async completeConnect(clubId: string, code: string): Promise<{ clubId: string }> {
    const tokens = await this.mp.exchangeCode(code, this.redirectUri());

    // Secreto para validar webhooks entrantes de este club. MP lo configura
    // en el panel; acá generamos uno propio si el club no lo trae, y lo
    // usamos consistentemente. (En producción, tomar el de MP.)
    const webhookSecret =
      this.config.get<string>('MP_WEBHOOK_SECRET') ??
      randomBytes(24).toString('hex');

    const expiresAt =
      tokens.expiresInSec > 0
        ? new Date(Date.now() + tokens.expiresInSec * 1000)
        : null;

    await this.prisma.db.clubPaymentIntegration.update({
      where: { clubId_provider: { clubId, provider: 'MERCADO_PAGO' } },
      data: {
        providerAccountId: tokens.userId,
        accessTokenEnc: this.crypto.encrypt(tokens.accessToken),
        refreshTokenEnc: this.crypto.encrypt(tokens.refreshToken),
        webhookSecretEnc: this.crypto.encrypt(webhookSecret),
        publicKey: tokens.publicKey,
        scope: tokens.scope,
        expiresAt,
        status: 'CONNECTED',
        connectedAt: new Date(),
        lastError: null,
      },
    });

    this.log.log(`Club ${clubId} conectó Mercado Pago (cuenta ${tokens.userId}).`);
    return { clubId };
  }

  /** El club desconecta su cuenta. No borra: marca REVOKED (auditoría). */
  async disconnect(clubId: string): Promise<void> {
    await this.prisma.db.clubPaymentIntegration.update({
      where: { clubId_provider: { clubId, provider: 'MERCADO_PAGO' } },
      data: {
        status: 'REVOKED',
        accessTokenEnc: null,
        refreshTokenEnc: null,
        webhookSecretEnc: null,
        deletedAt: new Date(),
      },
    });
  }

  /** Estado para mostrar en la UI (sin exponer secretos). */
  async getStatus(clubId: string) {
    const it = await this.prisma.db.clubPaymentIntegration.findUnique({
      where: { clubId_provider: { clubId, provider: 'MERCADO_PAGO' } },
      select: {
        status: true,
        providerAccountId: true,
        publicKey: true,
        connectedAt: true,
        expiresAt: true,
        lastError: true,
      },
    });
    return it ?? { status: 'PENDING' };
  }

  /**
   * Devuelve un access token USABLE del club, renovándolo si está por vencer.
   * Todo el que necesite cobrar pasa por acá; nunca lee el token crudo.
   */
  async getUsableAccessToken(clubId: string): Promise<string> {
    const it = await this.requireConnected(clubId);

    const soon = Date.now() + 5 * 60_000; // margen de 5 minutos
    const needsRefresh =
      it.expiresAt != null && it.expiresAt.getTime() < soon && it.refreshTokenEnc;

    if (needsRefresh && it.refreshTokenEnc) {
      try {
        const refreshed = await this.mp.refreshAccessToken(
          this.crypto.decrypt(it.refreshTokenEnc),
        );
        const expiresAt =
          refreshed.expiresInSec > 0
            ? new Date(Date.now() + refreshed.expiresInSec * 1000)
            : null;
        await this.prisma.db.clubPaymentIntegration.update({
          where: { id: it.id },
          data: {
            accessTokenEnc: this.crypto.encrypt(refreshed.accessToken),
            refreshTokenEnc: this.crypto.encrypt(refreshed.refreshToken),
            expiresAt,
            lastSyncAt: new Date(),
          },
        });
        return refreshed.accessToken;
      } catch (err) {
        await this.prisma.db.clubPaymentIntegration.update({
          where: { id: it.id },
          data: { status: 'EXPIRED', lastError: (err as Error).message },
        });
        throw new ConflictException(
          'La conexión con Mercado Pago venció. El club debe reconectar.',
        );
      }
    }

    if (!it.accessTokenEnc) {
      throw new ConflictException('El club no tiene un token de MP válido.');
    }
    return this.crypto.decrypt(it.accessTokenEnc);
  }

  /** El secreto de webhook del club, descifrado (para verificar firmas). */
  async getWebhookSecret(clubId: string): Promise<string | null> {
    const it = await this.prisma.db.clubPaymentIntegration.findUnique({
      where: { clubId_provider: { clubId, provider: 'MERCADO_PAGO' } },
      select: { webhookSecretEnc: true },
    });
    return it?.webhookSecretEnc ? this.crypto.decrypt(it.webhookSecretEnc) : null;
  }

  private async requireConnected(clubId: string) {
    const it = await this.prisma.db.clubPaymentIntegration.findUnique({
      where: { clubId_provider: { clubId, provider: 'MERCADO_PAGO' } },
    });
    if (!it || it.status !== 'CONNECTED') {
      throw new NotFoundException(
        'El club no tiene Mercado Pago conectado. Conectalo en Configuración.',
      );
    }
    return it;
  }

  // ---- firma del state (CSRF) ----

  private stateSecret(): string {
    return this.config.get<string>('MP_STATE_SECRET') ?? this.config.get<string>('PAYMENTS_ENC_KEY') ?? '';
  }

  private signState(clubId: string, nonce: string): string {
    const ts = Date.now().toString();
    const payload = `${clubId}.${nonce}.${ts}`;
    const sig = createHmac('sha256', this.stateSecret())
      .update(payload)
      .digest('hex');
    return Buffer.from(`${payload}.${sig}`).toString('base64url');
  }

  private verifyState(state: string): string | null {
    try {
      const decoded = Buffer.from(state, 'base64url').toString('utf8');
      const [clubId, nonce, ts, sig] = decoded.split('.');
      if (!clubId || !nonce || !ts || !sig) return null;

      // Expira a los 15 minutos.
      if (Date.now() - Number(ts) > 15 * 60_000) return null;

      const expected = createHmac('sha256', this.stateSecret())
        .update(`${clubId}.${nonce}.${ts}`)
        .digest('hex');
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

      return clubId;
    } catch {
      return null;
    }
  }
}
