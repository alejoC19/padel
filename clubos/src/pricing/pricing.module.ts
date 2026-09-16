import { Module } from '@nestjs/common';
import { PriceRuleController } from './price-rule.controller';
import { PriceRuleService } from './services/price-rule.service';

@Module({
  controllers: [PriceRuleController],
  providers: [PriceRuleService],
})
export class PricingModule {}
