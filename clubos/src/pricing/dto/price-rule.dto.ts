import {
  IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsUUID, Max, Min,
} from 'class-validator';
import { BookingTypeEnum } from '../../bookings/dto/booking.dto';

export class CreatePriceRuleDto {
  @IsOptional()
  @IsUUID('4')
  courtId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  fromMinute?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  toMinute?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  durationMinutes?: number;

  @IsOptional()
  @IsEnum(BookingTypeEnum)
  bookingType?: BookingTypeEnum;

  /** Tarifa POR JUGADOR — ver PricingService.quote (PLAYERS_PER_COURT). */
  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsInt()
  priority?: number;
}

export class UpdatePriceRuleDto {
  @IsOptional()
  @IsUUID('4')
  courtId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  fromMinute?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  toMinute?: number | null;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  durationMinutes?: number | null;

  @IsOptional()
  @IsEnum(BookingTypeEnum)
  bookingType?: BookingTypeEnum | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
