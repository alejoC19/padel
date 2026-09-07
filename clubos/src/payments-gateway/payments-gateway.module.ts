import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsController } from './payments.controller';
import { MercadoPagoWebhookController } from './mercadopago-webhook.controller';
import { CryptoService } from './services/crypto.service';
import { MercadoPagoClient } from './services/mercadopago.client';
import { IntegrationService } from './services/integration.service';
import { PaymentOrderService } from './services/payment-order.service';

/**
 * Módulo de pagos online (Mercado Pago, marketplace).
 *
 * Importa BookingsModule para reutilizar PaymentService: el pago online
 * termina en el MISMO camino contable que un cobro de mostrador.
 *
 * Recordar registrar este módulo en app.module.ts.
 */
@Module({
  imports: [BookingsModule, NotificationsModule],
  controllers: [PaymentsController, MercadoPagoWebhookController],
  providers: [
    CryptoService,
    MercadoPagoClient,
    IntegrationService,
    PaymentOrderService,
  ],
  exports: [IntegrationService, PaymentOrderService],
})
export class PaymentsGatewayModule {}
