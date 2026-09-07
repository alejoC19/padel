import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

/**
 * Alta de un club nuevo + su dueño, en un solo paso.
 *
 * Es el endpoint que convierte "una persona quiere probar ClubOS" en
 * "existe un club funcionando con un dueño que puede entrar".
 */
export class CreateClubDto {
  // ---- Club ----
  @IsString()
  @Length(2, 80)
  clubName!: string;

  /**
   * Subdominio: clubxyz.clubos.com. Minúsculas, números y guiones.
   * No empieza ni termina en guión.
   */
  @IsString()
  @Length(3, 40)
  @Matches(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message:
      'El slug solo admite minúsculas, números y guiones (sin espacios ni acentos).',
  })
  slug!: string;

  @IsOptional()
  @IsString()
  @Length(11, 11, { message: 'El CUIT debe tener 11 dígitos.' })
  taxId?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  city?: string;

  // ---- Dueño ----
  @IsString()
  @Length(1, 60)
  firstName!: string;

  @IsString()
  @Length(1, 60)
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  password!: string;

  /** Plan al que se suscribe. Si se omite, arranca en el plan starter. */
  @IsOptional()
  @IsString()
  planCode?: string;
}

/** Chequeo de disponibilidad de slug (como un dominio). */
export class CheckSlugDto {
  @IsString()
  @Length(3, 40)
  slug!: string;
}
