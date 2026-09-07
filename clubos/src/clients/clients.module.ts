import { Module } from '@nestjs/common';
import { ClientController } from './client.controller';
import { ClientService } from './services/client.service';
import { ClientSearchService } from './services/client-search.service';
import { PlanLimitsService } from '../common/services/plan-limits.service';

@Module({
  controllers: [ClientController],
  providers: [ClientService, ClientSearchService, PlanLimitsService],
  exports: [ClientService, ClientSearchService],
})
export class ClientsModule {}
