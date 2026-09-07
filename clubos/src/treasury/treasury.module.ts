import { Module } from '@nestjs/common';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './services/treasury.service';
import { CashFlowService } from './services/cash-flow.service';
import { ExpenseService } from './services/expense.service';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
  // DocumentNumberService vive en BookingsModule: la numeración de gastos usa
  // el mismo contador atómico que reservas y pagos.
  imports: [BookingsModule],
  controllers: [TreasuryController],
  providers: [TreasuryService, CashFlowService, ExpenseService],
  exports: [TreasuryService, CashFlowService, ExpenseService],
})
export class TreasuryModule {}
