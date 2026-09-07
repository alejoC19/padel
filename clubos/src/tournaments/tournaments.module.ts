import { Module } from '@nestjs/common';
import { TournamentsController } from './tournaments.controller';
import { TournamentService } from './services/tournament.service';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
  // PaymentService: la inscripción se cobra por el mismo circuito que una
  // reserva, para que la recaudación del torneo entre al arqueo.
  imports: [BookingsModule],
  controllers: [TournamentsController],
  providers: [TournamentService],
  exports: [TournamentService],
})
export class TournamentsModule {}
