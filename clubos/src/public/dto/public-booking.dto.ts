import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

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
