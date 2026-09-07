import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
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
  MinLength,
} from 'class-validator';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export enum DocumentTypeEnum {
  DNI = 'DNI', CUIT = 'CUIT', CUIL = 'CUIL', PASSPORT = 'PASSPORT', OTHER = 'OTHER',
}
export enum GenderEnum {
  MALE = 'MALE', FEMALE = 'FEMALE', OTHER = 'OTHER', UNDISCLOSED = 'UNDISCLOSED',
}
export enum SkillLevelEnum {
  BEGINNER = 'BEGINNER', INTERMEDIATE = 'INTERMEDIATE',
  ADVANCED = 'ADVANCED', PROFESSIONAL = 'PROFESSIONAL',
}
export enum DominantHandEnum {
  RIGHT = 'RIGHT', LEFT = 'LEFT', AMBIDEXTROUS = 'AMBIDEXTROUS',
}
export enum CourtSideEnum {
  DRIVE = 'DRIVE', REVES = 'REVES', BOTH = 'BOTH',
}
export enum ClientStatusEnum {
  ACTIVE = 'ACTIVE', INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED', BLACKLISTED = 'BLACKLISTED',
}

export class CreateClientDto {
  @trim() @IsString() @MinLength(2) @MaxLength(50)
  firstName!: string;

  @trim() @IsString() @MinLength(2) @MaxLength(50)
  lastName!: string;

  @IsOptional() @IsEnum(DocumentTypeEnum)
  documentType?: DocumentTypeEnum;

  @IsOptional() @trim() @IsString() @MaxLength(20)
  documentNumber?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Formato: YYYY-MM-DD' })
  birthDate?: string;

  @IsOptional() @IsEnum(GenderEnum)
  gender?: GenderEnum;

  @IsOptional() @IsEmail({}, { message: 'Email inválido' }) @MaxLength(255)
  email?: string;

  @IsOptional() @trim() @Matches(/^\+?[0-9\s\-()]{8,20}$/, { message: 'Teléfono inválido' })
  phone?: string;

  @IsOptional() @trim() @Matches(/^\+?[0-9\s\-()]{8,20}$/, { message: 'WhatsApp inválido' })
  whatsapp?: string;

  @IsOptional() @trim() @IsString() @MaxLength(200)
  addressStreet?: string;

  @IsOptional() @trim() @IsString() @MaxLength(100)
  addressCity?: string;

  @IsOptional() @trim() @IsString() @MaxLength(20)
  addressZip?: string;

  @IsOptional() @IsEnum(SkillLevelEnum)
  skillLevel?: SkillLevelEnum;

  @IsOptional() @IsEnum(DominantHandEnum)
  dominantHand?: DominantHandEnum;

  @IsOptional() @IsEnum(CourtSideEnum)
  preferredSide?: CourtSideEnum;

  @IsOptional() @trim() @IsString() @MaxLength(50)
  category?: string;

  @IsOptional() @IsUUID('4')
  priceListId?: string;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  discountPercent?: number;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  creditLimit?: number;

  @IsOptional() @IsBoolean()
  acceptsMarketing?: boolean;

  @IsOptional() @IsBoolean()
  acceptsWhatsapp?: boolean;

  /** Confirma el alta pese a los duplicados detectados. */
  @IsOptional() @IsBoolean()
  force?: boolean;
}

export class UpdateClientDto {
  @IsOptional() @trim() @IsString() @MinLength(2) @MaxLength(50)
  firstName?: string;

  @IsOptional() @trim() @IsString() @MinLength(2) @MaxLength(50)
  lastName?: string;

  @IsOptional() @IsEnum(DocumentTypeEnum)
  documentType?: DocumentTypeEnum;

  @IsOptional() @trim() @IsString() @MaxLength(20)
  documentNumber?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  birthDate?: string;

  @IsOptional() @IsEnum(GenderEnum)
  gender?: GenderEnum;

  @IsOptional() @IsEmail() @MaxLength(255)
  email?: string;

  @IsOptional() @trim() @Matches(/^\+?[0-9\s\-()]{8,20}$/)
  phone?: string;

  @IsOptional() @trim() @Matches(/^\+?[0-9\s\-()]{8,20}$/)
  whatsapp?: string;

  @IsOptional() @trim() @IsString() @MaxLength(200)
  addressStreet?: string;

  @IsOptional() @trim() @IsString() @MaxLength(100)
  addressCity?: string;

  @IsOptional() @trim() @IsString() @MaxLength(20)
  addressZip?: string;

  @IsOptional() @IsEnum(SkillLevelEnum)
  skillLevel?: SkillLevelEnum;

  @IsOptional() @IsEnum(DominantHandEnum)
  dominantHand?: DominantHandEnum;

  @IsOptional() @IsEnum(CourtSideEnum)
  preferredSide?: CourtSideEnum;

  @IsOptional() @trim() @IsString() @MaxLength(50)
  category?: string;

  @IsOptional() @IsEnum(ClientStatusEnum)
  status?: ClientStatusEnum;

  @IsOptional() @IsUUID('4')
  priceListId?: string;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  discountPercent?: number;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  creditLimit?: number;

  @IsOptional() @IsBoolean()
  acceptsMarketing?: boolean;

  @IsOptional() @IsBoolean()
  acceptsWhatsapp?: boolean;
}

export class SearchClientsDto {
  @trim() @IsString() @MinLength(2, { message: 'Escribí al menos 2 caracteres' })
  q!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  limit?: number;

  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean()
  includeInactive?: boolean;
}

export class ListClientsDto {
  @IsOptional() @IsEnum(ClientStatusEnum)
  status?: ClientStatusEnum;

  @IsOptional() @IsString() @MaxLength(30)
  tagCode?: string;

  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean()
  debtorsOnly?: boolean;

  /** Sin visitas en los últimos N días. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650)
  inactiveDays?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12)
  birthdayMonth?: number;

  @IsOptional() @IsEnum(['alpha', 'recent', 'spent'])
  sortBy?: 'alpha' | 'recent' | 'spent';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

export class CreateNoteDto {
  @IsString() @MinLength(1) @MaxLength(2000)
  content!: string;

  @IsOptional() @IsEnum(['GENERAL','PREFERENCE','COMPLAINT','MEDICAL','BILLING','INCIDENT'])
  category?: string;

  @IsOptional() @IsEnum(['LOW','NORMAL','HIGH','CRITICAL'])
  priority?: string;

  @IsOptional() @IsBoolean()
  isInternal?: boolean;
}

export class StatementDto {
  @IsOptional() @IsString()
  from?: string;

  @IsOptional() @IsString()
  to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  limit?: number;
}
