import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export enum BookingTypeEnum {
  REGULAR = 'REGULAR',
  LESSON = 'LESSON',
  TOURNAMENT = 'TOURNAMENT',
  EVENT = 'EVENT',
}

export enum BookingSourceEnum {
  ADMIN = 'ADMIN',
  RECEPTION = 'RECEPTION',
  CLIENT_WEB = 'CLIENT_WEB',
  CLIENT_APP = 'CLIENT_APP',
  WHATSAPP = 'WHATSAPP',
  PHONE = 'PHONE',
}

export class BookingPlayerDto {
  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  guestName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9\s\-()]{8,20}$/, { message: 'Teléfono inválido' })
  guestPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  guestEmail?: string;

  @IsOptional()
  @IsBoolean()
  isOrganizer?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  shareAmount?: number;
}

export class BookingPaymentDto {
  @IsOptional()
  @IsUUID('4')
  paymentMethodId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsUUID('4')
  cashSessionId?: string;

  /** Deja el total en cuenta corriente del cliente en vez de cobrarlo. */
  @IsOptional()
  @IsBoolean()
  toAccount?: boolean;
}

export class CreateBookingDto {
  @IsUUID('4')
  courtId!: string;

  @IsDateString()
  startsAt!: string;

  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  durationMinutes!: number;

  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  @IsOptional()
  @IsUUID('4')
  instructorId?: string;

  @IsOptional()
  @IsEnum(BookingTypeEnum)
  type?: BookingTypeEnum;

  @IsOptional()
  @IsEnum(BookingSourceEnum)
  source?: BookingSourceEnum;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  playersCount?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => BookingPlayerDto)
  players?: BookingPlayerDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => BookingPaymentDto)
  payment?: BookingPaymentDto;

  /** Precio manual. Requiere permiso BOOKING_OVERRIDE. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  overridePrice?: number;

  @IsOptional()
  @IsBoolean()
  allowOutsideHours?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPast?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  internalNotes?: string;
}

export class CancelBookingDto {
  @IsOptional()
  @IsEnum(['CLIENT', 'CLUB'])
  cancelledBy?: 'CLIENT' | 'CLUB';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsUUID('4')
  cashSessionId?: string;
}

export class RescheduleBookingDto {
  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @IsUUID('4')
  courtId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  allowOutsideHours?: boolean;
}

export class CollectPaymentDto {
  @IsUUID('4')
  paymentMethodId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsUUID('4')
  cashSessionId?: string;
}

export class NoShowDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
