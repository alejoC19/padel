import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicPlayerController } from './public-player.controller';
import { PublicService } from './public.service';
import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsGatewayModule } from '../payments-gateway/payments-gateway.module';

/**
 * Módulo de endpoints públicos para la app del jugador.
 * Importa BookingsModule para reusar AgendaService y ClubConfigService, y
 * PaymentsGatewayModule para que el jugador pueda pagar online (Checkout
 * Pro) la reserva que acaba de crear, sin duplicar la integración con MP.
 * PrismaModule es global, así que PrismaService se inyecta directo.
 */
@Module({
  imports: [BookingsModule, PaymentsGatewayModule],
  controllers: [PublicController, PublicPlayerController],
  providers: [PublicService],
})
export class PublicModule {}
