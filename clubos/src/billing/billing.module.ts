import { Module } from '@nestjs/common';
import { TrialExpiryService } from './services/trial-expiry.service';

/**
 * Jobs de plataforma relacionados a planes/suscripción.
 * El @Cron se habilita con ScheduleModule.forRoot() en AppModule.
 */
@Module({
  providers: [TrialExpiryService],
})
export class BillingModule {}
