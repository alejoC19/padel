import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum CourtEnvironmentEnum {
  INDOOR = 'INDOOR',
  OUTDOOR = 'OUTDOOR',
  COVERED = 'COVERED',
}

export enum CourtSurfaceEnum {
  SYNTHETIC_GRASS = 'SYNTHETIC_GRASS',
  CONCRETE = 'CONCRETE',
  CLAY = 'CLAY',
  CRYSTAL = 'CRYSTAL',
  OTHER = 'OTHER',
}

export enum CourtStatusEnum {
  AVAILABLE = 'AVAILABLE',
  MAINTENANCE = 'MAINTENANCE',
  DISABLED = 'DISABLED',
}

export class CreateCourtDto {
  @IsUUID('4')
  sportId!: string;

  @IsString()
  @MaxLength(60)
  name!: string;

  @IsInt()
  @Min(1)
  number!: number;

  @IsOptional()
  @IsEnum(CourtEnvironmentEnum)
  environment?: CourtEnvironmentEnum;

  @IsOptional()
  @IsEnum(CourtSurfaceEnum)
  surface?: CourtSurfaceEnum;

  @IsOptional()
  @IsBoolean()
  hasLighting?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  capacity?: number;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  slotMinutes?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];
}

export class UpdateCourtDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsEnum(CourtStatusEnum)
  status?: CourtStatusEnum;

  @IsOptional()
  @IsEnum(CourtEnvironmentEnum)
  environment?: CourtEnvironmentEnum;

  @IsOptional()
  @IsEnum(CourtSurfaceEnum)
  surface?: CourtSurfaceEnum;

  @IsOptional()
  @IsBoolean()
  hasLighting?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  capacity?: number;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  slotMinutes?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];
}
