import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosService } from './services/pos.service';
import { StockService } from './services/stock.service';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
  // PaymentService y DocumentNumberService viven en BookingsModule: el cobro
  // es el mismo mecanismo para una reserva que para una Coca, y duplicarlo
  // sería tener dos formas de escribir en la caja.
  imports: [BookingsModule],
  controllers: [PosController],
  providers: [PosService, StockService],
  exports: [PosService, StockService],
})
export class PosModule {}
