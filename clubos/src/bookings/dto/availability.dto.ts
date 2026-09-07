import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class GetAvailabilityDto {
  @Matches(LOCAL_DATE, { message: 'Formato esperado: YYYY-MM-DD' })
  date!: string;

  @IsOptional()
  @IsUUID('4')
  courtId?: string;

  @IsOptional()
  @IsUUID('4')
  sportId?: string;

  /**
   * Duración a evaluar. Sin ella se usa el paso de grilla de la cancha,
   * que muestra la agenda cruda en vez de "dónde entra un turno de 90".
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  durationMinutes?: number;
}

export class GetRangeAvailabilityDto {
  @Matches(LOCAL_DATE, { message: 'Formato esperado: YYYY-MM-DD' })
  fromDate!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  days!: number;

  @IsOptional()
  @IsUUID('4')
  courtId?: string;

  @IsOptional()
  @IsUUID('4')
  sportId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  durationMinutes?: number;
}

export class GetAgendaDayDto {
  @Matches(LOCAL_DATE, { message: 'Formato esperado: YYYY-MM-DD' })
  date!: string;

  @IsOptional()
  @IsUUID('4')
  courtId?: string;

  @IsOptional()
  @IsUUID('4')
  sportId?: string;

  @IsOptional()
  @IsUUID('4')
  instructorId?: string;
}

export enum BookingTypeDto {
  REGULAR = 'REGULAR',
  LESSON = 'LESSON',
  TOURNAMENT = 'TOURNAMENT',
  EVENT = 'EVENT',
}

export class QuotePriceDto {
  @IsUUID('4')
  courtId!: string;

  /** Instante de inicio en ISO 8601 con zona. Ej: 2026-07-25T23:00:00Z */
  @IsDateString()
  startsAt!: string;

  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  durationMinutes!: number;

  @IsOptional()
  @IsEnum(BookingTypeDto)
  bookingType?: BookingTypeDto;

  @IsOptional()
  @IsUUID('4')
  @Transform(({ value }) => (value === '' ? undefined : value))
  clientId?: string;
}
