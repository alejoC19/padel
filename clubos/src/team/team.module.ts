import { Module } from '@nestjs/common';
import { TeamController } from './team.controller';
import { TeamService } from './services/team.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [TeamController],
  providers: [TeamService],
})
export class TeamModule {}
