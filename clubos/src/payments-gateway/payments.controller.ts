import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ClubId,
  RequirePermissions,
  UserId,
} from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import { IntegrationService } from './services/integration.service';
import { PaymentOrderService } from './services/payment-order.service';
import { CreateBookingOrderDto } from './dto/payment-gateway.dto';

/**
 * Endpoints autenticados del club (dueño / recepción).
 *
 * Conectar Mercado Pago es una acción de configuración → CLUB_SETTINGS.
 * Crear una orden de cobro es parte del flujo de pago → PAYMENT_CREATE.
 */
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly integration: IntegrationService,
    private readonly orders: PaymentOrderService,
  ) {}

  /** Estado de la conexión con Mercado Pago (para la pantalla de config). */
  @Get('mercadopago/status')
  @RequirePermissions(PERMISSIONS.CLUB_SETTINGS)
  status(@ClubId() clubId: string) {
    return this.integration.getStatus(clubId);
  }

  /**
   * Inicia la conexión: devuelve la URL a la que mandar al dueño para que
   * autorice en Mercado Pago. El frontend hace window.location = authorizationUrl.
   */
  @Post('mercadopago/connect')
  @RequirePermissions(PERMISSIONS.CLUB_SETTINGS)
  connect(@ClubId() clubId: string) {
    return this.integration.beginConnect(clubId);
  }

  /** Desconecta la cuenta de Mercado Pago del club. */
  @Post('mercadopago/disconnect')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.CLUB_SETTINGS)
  async disconnect(@ClubId() clubId: string) {
    await this.integration.disconnect(clubId);
  }

  /**
   * Crea una orden de pago para una reserva y devuelve el link de Checkout Pro.
   * El frontend redirige al jugador a `initPoint`.
   */
  @Post('orders/booking')
  @RequirePermissions(PERMISSIONS.PAYMENT_CREATE)
  createBookingOrder(
    @ClubId() clubId: string,
    @UserId() userId: string,
    @Body() dto: CreateBookingOrderDto,
  ) {
    return this.orders.createForBooking({
      clubId,
      bookingId: dto.bookingId,
      createdById: userId,
    });
  }
}
