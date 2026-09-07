import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { AvailabilityService } from './services/availability.service';
import { AgendaService } from './services/agenda.service';
import { PricingService } from './services/pricing.service';
import { ClubConfigService } from './services/club-config.service';
import {
  GetAgendaDayDto,
  GetAvailabilityDto,
  GetRangeAvailabilityDto,
  QuotePriceDto,
} from './dto/availability.dto';
import { ClubId, RequirePermissions } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

@Controller('agenda')
export class AvailabilityController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly agenda: AgendaService,
    private readonly pricing: PricingService,
    private readonly config: ClubConfigService,
  ) {}

  /**
   * Tablero del día: canchas, reservas con su detalle, bloqueos y totales.
   * Es lo que consume la pantalla de agenda — una sola llamada por día.
   */
  @Get('day')
  @RequirePermissions(PERMISSIONS.BOOKING_VIEW)
  async getAgendaDay(
    @Query() q: GetAgendaDayDto,
    @ClubId() clubId: string,
  ) {
    const tz = await this.config.timezone(clubId);
    return this.agenda.getDay(q.date, tz, {
      courtId: q.courtId,
      sportId: q.sportId,
      instructorId: q.instructorId,
    });
  }

  /** Horarios libres para cotizar. No trae detalle de las reservas. */
  @Get('availability')
  @RequirePermissions(PERMISSIONS.BOOKING_VIEW)
  async getDay(@Query() q: GetAvailabilityDto, @ClubId() clubId: string) {
    const tz = await this.config.timezone(clubId);
    const courts = await this.availability.getDayAvailability(q, tz);
    return { date: q.date, timezone: tz, courts };
  }

  /** Vista semanal / rango. */
  @Get('availability/range')
  @RequirePermissions(PERMISSIONS.BOOKING_VIEW)
  async getRange(
    @Query() q: GetRangeAvailabilityDto,
    @ClubId() clubId: string,
  ) {
    const tz = await this.config.timezone(clubId);
    const days = await this.availability.getRangeAvailability(
      q.fromDate,
      q.days,
      tz,
      {
        courtId: q.courtId,
        sportId: q.sportId,
        durationMinutes: q.durationMinutes,
      },
    );
    return { fromDate: q.fromDate, days: q.days, timezone: tz, availability: days };
  }

  /**
   * Cotiza un turno antes de reservarlo.
   *
   * POST y no GET porque el cuerpo incluye clientId, y no conviene que un
   * identificador de cliente quede registrado en los logs de acceso del
   * servidor y del proxy, como pasaría en la query string.
   */
  @Post('quote')
  @RequirePermissions(PERMISSIONS.BOOKING_VIEW)
  async quote(@Body() dto: QuotePriceDto, @ClubId() clubId: string) {
    const tz = await this.config.timezone(clubId);
    const startsAt = new Date(dto.startsAt);

    const quote = await this.pricing.quote({
      courtId: dto.courtId,
      startsAt,
      durationMinutes: dto.durationMinutes,
      bookingType: dto.bookingType,
      clientId: dto.clientId ?? null,
      timezone: tz,
    });

    const endsAt = new Date(startsAt.getTime() + dto.durationMinutes * 60_000);

    const [slotFree, withinHours] = await Promise.all([
      this.availability.isSlotFree(dto.courtId, startsAt, endsAt),
      this.availability.isWithinOperatingHours(
        dto.courtId,
        startsAt,
        endsAt,
        tz,
      ),
    ]);

    return {
      ...quote,
      startsAt,
      endsAt,
      // Informativo: la disponibilidad real se decide al confirmar.
      slotFree,
      withinOperatingHours: withinHours,
    };
  }
}
