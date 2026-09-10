import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateClubDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /** URL del logo — la PWA instalable de cada club (ver manifest.webmanifest) lo usa como ícono. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverUrl?: string;
}
