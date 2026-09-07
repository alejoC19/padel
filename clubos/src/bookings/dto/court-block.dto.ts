import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export enum BlockTypeEnum {
  MAINTENANCE = 'MAINTENANCE',
  EVENT = 'EVENT',
  HOLIDAY = 'HOLIDAY',
  ADMIN = 'ADMIN',
  WEATHER = 'WEATHER',
}

export class CreateCourtBlockDto {
  /** Si se omite, el bloqueo aplica a TODAS las canchas del club. */
  @IsOptional()
  @IsUUID('4')
  courtId?: string;

  @IsEnum(BlockTypeEnum)
  type!: BlockTypeEnum;

  @IsString()
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;
}
