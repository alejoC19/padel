import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { Public, SkipTenant } from '../common/decorators';
import { runWithTenant, type TenantContext } from '../tenancy/tenant-context';
import { IntegrationService } from './services/integration.service';
import { PaymentOrderService } from './services/payment-order.service';
import { MercadoPagoClient } from './services/mercadopago.client';

/**
 * Contexto de tenant para operaciones de sistema disparadas por MP (no por un
 * usuario logueado). Fija el clubId para que la RLS deje operar sobre las
 * tablas del club, sin abrir el bypass global de plataforma.
 */
function systemTenantContext(clubId: string): TenantContext {
  return {
    clubId,
    userId: null,
    membershipId: null,
    roleCode: 'SYSTEM',
    permissions: new Set(),
    isPlatformAdmin: false,
    requestId: randomUUID(),
    bypassTenancy: false,
  };
}

/**
 * Endpoints PÚBLICOS que consume Mercado Pago (no el club, no el jugador).
 *
 *   /payments/mercadopago/oauth/callback  → vuelta del OAuth del dueño
 *   /payments/mercadopago/webhook         → notificaciones de pago
 *
 * Ambos van SIN autenticación de usuario (@Public + @SkipTenant): no hay JWT.
 * La seguridad del webhook está en la VERIFICACIÓN DE FIRMA, no en un token.
 */
@Controller('payments/mercadopago')
@Public()
@SkipTenant()
export class MercadoPagoWebhookController {
  private readonly log = new Logger(MercadoPagoWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly integration: IntegrationService,
    private readonly orders: PaymentOrderService,
    private readonly mp: MercadoPagoClient,
  ) {}

  /**
   * Callback de OAuth. MP redirige el navegador del dueño acá con ?code&state.
   * Canjeamos el code, guardamos tokens, y redirigimos a la app.
   */
  @Get('oauth/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const web = this.config.get<string>('WEB_PUBLIC_URL') ?? '';
    try {
      if (!code || !state) {
        return res.redirect(`${web}/configuracion/pagos?mp=error`);
      }
      // Resolver el club del state firmado ANTES de tocar la BD, y montar el
      // contexto de tenant para que la escritura respete la RLS.
      const clubId = this.integration.resolveClubFromState(state);
      await runWithTenant(systemTenantContext(clubId), () =>
        this.integration.completeConnect(clubId, code),
      );
      return res.redirect(`${web}/configuracion/pagos?mp=conectado`);
    } catch (err) {
      this.log.warn(`OAuth callback falló: ${(err as Error).message}`);
      return res.redirect(`${web}/configuracion/pagos?mp=error`);
    }
  }

  /**
   * Webhook de notificaciones de pago.
   *
   * Reglas de oro de un webhook:
   *   1. Verificar la firma ANTES de hacer nada.
   *   2. Responder 200 rápido; el trabajo pesado no debe demorar la respuesta
   *      (MP reintenta si tardás o fallás, y no querés reintentos en cascada).
   *   3. Ser idempotente: el mismo evento puede llegar varias veces.
   *
   * MP manda el club en el query (?club=), que nosotros mismos pusimos en la
   * notification_url al crear la preferencia. El `data.id` es el id del pago.
   */
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Query('club') clubId: string,
    @Query('id') queryId: string,
    @Query('topic') topic: string,
    @Headers('x-signature') xSignature: string,
    @Headers('x-request-id') xRequestId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Responder OK siempre y cuanto antes: la validación/errores se loguean,
    // pero a MP le decimos 200 para que no reintente en loop. Si algo real
    // falla, un cron de reconciliación lo recupera.
    const body = (req.body ?? {}) as Record<string, any>;
    const dataId =
      String(body?.data?.id ?? queryId ?? body?.id ?? '') || '';
    const type = String(body?.type ?? topic ?? '');

    // Solo nos interesan notificaciones de pago.
    if (type && type !== 'payment') {
      return res.status(HttpStatus.OK).send({ ignored: type });
    }
    if (!clubId || !dataId) {
      return res.status(HttpStatus.OK).send({ ignored: 'faltan datos' });
    }

    try {
      // Todo el trabajo corre bajo el contexto de tenant del club, para que
      // la RLS permita leer el secreto y escribir el pago.
      const result = await runWithTenant(
        systemTenantContext(clubId),
        async () => {
          // 1. Verificar firma contra el secreto del club.
          const secret = await this.integration.getWebhookSecret(clubId);
          if (secret) {
            const ok = this.mp.verifyWebhookSignature({
              xSignature: xSignature ?? '',
              xRequestId: xRequestId ?? '',
              dataId,
              secret,
            });
            if (!ok) {
              this.log.warn(`Webhook con firma inválida (club ${clubId}).`);
              return { ignored: 'firma inválida' as const };
            }
          }

          // 2. Procesar (idempotente). Consulta el pago real en MP.
          return this.orders.handleWebhook({
            clubId,
            providerPaymentId: dataId,
          });
        },
      );

      return res.status(HttpStatus.OK).send(result);
    } catch (err) {
      // No propagar el error a MP (evita reintentos); dejar rastro para el cron.
      this.log.error(
        `Error procesando webhook (club ${clubId}, pago ${dataId}): ${(err as Error).message}`,
      );
      return res.status(HttpStatus.OK).send({ handled: false, error: true });
    }
  }
}
