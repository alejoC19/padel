import { Module } from '@nestjs/common';
import { ClientController } from './client.controller';
import { ClientService } from './services/client.service';
import { ClientSearchService } from './services/client-search.service';

@Module({
  controllers: [ClientController],
  providers: [ClientService, ClientSearchService],
  exports: [ClientService, ClientSearchService],
})
export class ClientsModule {}
