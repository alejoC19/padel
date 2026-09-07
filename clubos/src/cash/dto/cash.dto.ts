import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export enum ManualMovementType {
  MANUAL_INCOME = 'MANUAL_INCOME',
  EXPENSE = 'EXPENSE',
  WITHDRAWAL = 'WITHDRAWAL',
  DEPOSIT = 'DEPOSIT',
  ADJUSTMENT = 'ADJUSTMENT',
}

export class OpenSessionDto {
  @IsUUID('4')
  registerId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  openingAmount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ManualMovementDto {
  @IsEnum(ManualMovementType)
  type!: ManualMovementType;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsString()
  @MaxLength(200)
  concept!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** Si se omite, se asume efectivo (afecta el arqueo). */
  @IsOptional()
  @IsUUID('4')
  paymentMethodId?: string;
}

export class CountCashDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  countedCash?: number;

  /**
   * Detalle por denominación: { "10000": 3, "1000": 12 }.
   * Si viene, tiene prioridad sobre countedCash.
   */
  @IsOptional()
  @IsObject()
  denominations?: Record<string, number>;
}

export class CloseSessionDto extends CountCashDto {
  /** Obligatorio si hay diferencia. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  differenceReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ReverseMovementDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class CashHistoryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsUUID('4')
  registerId?: string;
}
