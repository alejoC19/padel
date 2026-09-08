import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

const ACTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED',
  'EXPORT', 'PERMISSION_CHANGE', 'CASH_OPEN', 'CASH_CLOSE', 'PRICE_CHANGE',
  'REFUND', 'VOID',
] as const;

export class ListAuditLogsDto {
  @IsOptional() @IsIn(ACTIONS)
  action?: (typeof ACTIONS)[number];

  @IsOptional() @IsString() @MaxLength(50)
  entityType?: string;

  @IsOptional() @IsUUID('4')
  userId?: string;

  @IsOptional() @IsString()
  from?: string;

  @IsOptional() @IsString()
  to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}
