import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsNumber,
  IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested,
} from 'class-validator';

// DOUBLE_ELIMINATION existe como valor del enum en el schema (Prisma), pero
// el cuadro de perdedores no está implementado — generateElimination() lo
// arma como eliminación simple sin avisar, así que se saca de acá para que
// nadie pueda pedir un formato que no es el que realmente va a obtener.
// Sacarlo de este enum (no del de Prisma) alcanza: class-validator lo
// rechaza en el DTO antes de llegar al servicio.
export enum FormatEnum {
  ELIMINATION = 'ELIMINATION',
  ROUND_ROBIN = 'ROUND_ROBIN',
  GROUPS_PLAYOFF = 'GROUPS_PLAYOFF',
  AMERICANO = 'AMERICANO',
}

export class CreateTournamentDto {
  @IsString() @MaxLength(120)
  name!: string;

  @IsEnum(FormatEnum)
  format!: FormatEnum;

  @IsString()
  startsAt!: string;

  @IsOptional() @IsString()
  endsAt?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(2)
  maxTeams?: number;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  entryFee?: number;

  @IsOptional() @IsString() @MaxLength(50)
  category?: string;

  @IsOptional() @IsEnum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'PROFESSIONAL'])
  skillLevel?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  rules?: string;

  @IsOptional() @IsString() @MaxLength(500)
  prizeDescription?: string;

  @IsOptional() @IsString()
  registrationOpensAt?: string;

  @IsOptional() @IsString()
  registrationClosesAt?: string;
}

export class TeamPaymentDto {
  @IsUUID('4')
  paymentMethodId!: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01)
  amount!: number;

  @IsOptional() @IsUUID('4')
  cashSessionId?: string;
}

export class RegisterTeamDto {
  @IsString() @MaxLength(100)
  name!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'El equipo necesita al menos un jugador.' })
  @ArrayMaxSize(6)
  @IsUUID('4', { each: true })
  clientIds!: string[];

  @IsOptional() @ValidateNested() @Type(() => TeamPaymentDto)
  payment?: TeamPaymentDto;
}

export class GenerateFixtureDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  groupCount?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  americanoRounds?: number;
}

export class RecordResultDto {
  /** [[6,4],[3,6],[7,5]] — cada par es un set. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  scoreSets?: Array<[number, number]>;

  /** Si el partido no se jugó y hay un ganador por ausencia del rival. */
  @IsOptional() @IsUUID('4')
  walkoverWinnerId?: string;
}
