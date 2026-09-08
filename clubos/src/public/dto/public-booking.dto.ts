// `@ValidateNested`/`@Type` (más abajo, en InscribirEquipoDto) dependen del
// polyfill de metadata de reflect-metadata. La app lo carga en main.ts antes
// de todo, pero un test unitario que importa este archivo directo (como
// public-booking.dto.spec.ts) no pasa por ahí — sin este import, decorar la
// clase revienta con "Reflect.getMetadata is not a function". Importarlo acá
// es inofensivo si ya estaba cargado (idempotente).
import 'reflect-metadata';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsOptional,
  IsString, IsUUID, MaxLength, MinLength, ValidateNested,
} from 'class-validator';

/**
 * DTOs de los endpoints públicos (`PublicController`).
 *
 * A diferencia del resto del backend, estos endpoints los llama un visitante
 * anónimo desde internet — sin `@RequirePermissions`, sin auth. El
 * `ValidationPipe` global (whitelist + forbidNonWhitelisted + transform) solo
 * hace algo con una clase de class-validator: un tipo TS inline (lo que había
 * acá antes) desaparece en runtime y deja pasar cualquier cosa, confiando en
 * los chequeos manuales del service. Esas clases igual quedan como defensa en
 * profundidad (ver `public.service.ts`), pero la primera línea de defensa
 * contra un body malformado o abusivo (strings gigantes, tipos incorrectos)
 * tiene que ser el DTO, como en el resto del backend.
 */
export class ReservarDto {
  @IsUUID('4')
  courtId!: string;

  @IsDateString()
  startsAt!: string;

  /** Duraciones permitidas para reservas online: ver ALLOWED_DURATIONS en publicSlots.ts. */
  @IsIn([60, 90, 120])
  durationMinutes!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @IsString()
  @MinLength(6)
  @MaxLength(30)
  phone!: string;
}

export class AccessTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  accessToken!: string;
}

export class TeamPlayerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @IsString()
  @MinLength(6)
  @MaxLength(30)
  phone!: string;
}

/** Dobles de pádel: 1 a 2 jugadores por equipo (parejas). */
export class InscribirEquipoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  teamName!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => TeamPlayerDto)
  players!: TeamPlayerDto[];
}
