import { Module } from '@nestjs/common';
import { CashController } from './cash.controller';
import { CashService } from './services/cash.service';

@Module({
  controllers: [CashController],
  providers: [CashService],
  exports: [CashService],
})
export class CashModule {}
