import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

const lower = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

export class LoginDto {
  @lower()
  @IsEmail({}, { message: 'Email inválido' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(1, { message: 'La contraseña es requerida' })
  @MaxLength(128)
  password!: string;

  /**
   * Club a activar en el login. Opcional: si el usuario pertenece a uno
   * solo, se selecciona automáticamente. Si pertenece a varios y no lo
   * envía, el token sale sin club y el front muestra el selector.
   */
  @IsOptional()
  @IsUUID('4')
  clubId?: string;
}

export class RegisterDto {
  @lower()
  @IsEmail({}, { message: 'Email inválido' })
  @MaxLength(255)
  email!: string;

  /**
   * Política: 10+ caracteres con al menos una letra y un número.
   * Deliberadamente NO se exigen símbolos ni mayúsculas: la evidencia
   * (NIST SP 800-63B) muestra que esas reglas empujan a patrones
   * predecibles tipo "Password1!" sin ganancia real de entropía.
   */
  @IsString()
  @MinLength(10, { message: 'La contraseña debe tener al menos 10 caracteres' })
  @MaxLength(128)
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d).+$/, {
    message: 'La contraseña debe incluir al menos una letra y un número',
  })
  password!: string;

  @trim()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  firstName!: string;

  @trim()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  lastName!: string;

  @IsOptional()
  @trim()
  @IsString()
  @Matches(/^\+?[0-9\s\-()]{8,20}$/, { message: 'Teléfono inválido' })
  phone?: string;
}

export class RefreshDto {
  /** Opcional: si viene por cookie httpOnly no hace falta en el body. */
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class SwitchClubDto {
  @IsUUID('4')
  clubId!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d).+$/, {
    message: 'La contraseña debe incluir al menos una letra y un número',
  })
  newPassword!: string;
}

// --- Respuestas ---

export interface ClubSummary {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  roleCode: string;
  status: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    isPlatformAdmin: boolean;
  };
  activeClub: ClubSummary | null;
  clubs: ClubSummary[];
  permissions: string[];
}
