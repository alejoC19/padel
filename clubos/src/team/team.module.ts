import { Module } from '@nestjs/common';
import { TeamController } from './team.controller';
import { TeamService } from './services/team.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlanLimitsService } from '../common/services/plan-limits.service';

@Module({
  imports: [NotificationsModule],
  controllers: [TeamController],
  providers: [TeamService, PlanLimitsService],
})
export class TeamModule {}
