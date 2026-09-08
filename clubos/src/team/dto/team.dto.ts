import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
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

export class InviteStaffDto {
  @lower()
  @IsEmail({}, { message: 'Email inválido' })
  @MaxLength(255)
  email!: string;

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

  @IsUUID('4')
  roleId!: string;
}

export class UpdateMembershipDto {
  @IsOptional()
  @IsUUID('4')
  roleId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'SUSPENDED';
}
