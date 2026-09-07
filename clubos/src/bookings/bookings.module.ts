import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { BookingController } from './booking.controller';
import { AvailabilityService } from './services/availability.service';
import { AgendaService } from './services/agenda.service';
import { PricingService } from './services/pricing.service';
import { ClubConfigService } from './services/club-config.service';
import { BookingService } from './services/booking.service';
import { PaymentService } from './services/payment.service';
import { DocumentNumberService } from './services/document-number.service';

@Module({
  controllers: [AvailabilityController, BookingController],
  providers: [
    AvailabilityService,
    AgendaService,
    PricingService,
    ClubConfigService,
    BookingService,
    PaymentService,
    DocumentNumberService,
  ],
  exports: [
    AvailabilityService,
    AgendaService,
    PricingService,
    ClubConfigService,
    PaymentService,
    DocumentNumberService,
    BookingService,
  ],
})
export class BookingsModule {}
