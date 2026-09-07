import { Module } from '@nestjs/common';
import { CourtController } from './court.controller';
import { CourtService } from './services/court.service';
import { PlanLimitsService } from '../common/services/plan-limits.service';

@Module({
  controllers: [CourtController],
  providers: [CourtService, PlanLimitsService],
  exports: [CourtService, PlanLimitsService],
})
export class CourtsModule {}
