import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PublicController } from './public.controller';
import { PublicPlayerController } from './public-player.controller';
import { PublicAccountController } from './public-account.controller';
import { PublicService } from './public.service';
import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsGatewayModule } from '../payments-gateway/payments-gateway.module';

/**
 * Módulo de endpoints públicos para la app del jugador.
 * Importa BookingsModule para reusar AgendaService y ClubConfigService, y
 * PaymentsGatewayModule para que el jugador pueda pagar online (Checkout
 * Pro) la reserva que acaba de crear, sin duplicar la integración con MP.
 * PrismaModule es global, así que PrismaService se inyecta directo.
 *
 * JwtModule.register({}) (igual que en AuthModule): sin secret acá, se pasa
 * por llamada en `PublicController.optionalUserId` — necesario porque
 * `reservar()` decodifica el access token del panel de la cuenta cuando
 * viene, para vincular la reserva, pero sin exigirlo (sigue siendo público).
 */
@Module({
  imports: [JwtModule.register({}), BookingsModule, PaymentsGatewayModule],
  controllers: [PublicController, PublicPlayerController, PublicAccountController],
  providers: [PublicService],
})
export class PublicModule {}
