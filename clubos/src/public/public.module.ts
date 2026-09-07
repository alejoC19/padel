import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { BookingsModule } from '../bookings/bookings.module';

/**
 * Módulo de endpoints públicos para la app del jugador.
 * Importa BookingsModule para reusar AgendaService y ClubConfigService.
 * PrismaModule es global, así que PrismaService se inyecta directo.
 */
@Module({
  imports: [BookingsModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
