import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { DailyCloseService } from './services/daily-close.service';
import { ProfitabilityService } from './services/profitability.service';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
  // ClubConfigService vive en BookingsModule: la zona horaria del club es la
  // misma para la agenda que para los reportes.
  imports: [BookingsModule],
  controllers: [ReportsController],
  providers: [DailyCloseService, ProfitabilityService],
  exports: [DailyCloseService, ProfitabilityService],
})
export class ReportsModule {}
