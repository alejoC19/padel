import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsNumber,
  IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested,
} from 'class-validator';

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateAccountDto {
  @IsString() @MaxLength(80)
  bankName!: string;

  @IsString() @MaxLength(80)
  accountName!: string;

  @IsOptional() @IsEnum(['CHECKING', 'SAVINGS', 'VIRTUAL_WALLET'])
  accountType?: string;

  @IsOptional() @IsString() @Matches(/^\d{22}$/, { message: 'El CBU tiene 22 dígitos' })
  cbu?: string;

  @IsOptional() @IsString() @MaxLength(30)
  alias?: string;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 })
  initialBalance?: number;
}

export class StatementRowDto {
  @Matches(LOCAL_DATE, { message: 'Formato esperado: YYYY-MM-DD' })
  date!: string;

  @IsString() @MaxLength(300)
  description!: string;

  /** Signado: positivo entra, negativo sale. */
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @IsOptional() @IsString() @MaxLength(80)
  reference?: string;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 })
  balanceAfter?: number;
}

export class ImportStatementDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => StatementRowDto)
  rows!: StatementRowDto[];

  @IsOptional() @IsEnum(['IMPORT_CSV', 'IMPORT_XLSX', 'MANUAL'])
  source?: 'IMPORT_CSV' | 'IMPORT_XLSX' | 'MANUAL';
}

export class ReconcileDto {
  @IsEnum(['PAYMENT', 'EXPENSE'])
  kind!: 'PAYMENT' | 'EXPENSE';

  @IsUUID('4')
  id!: string;
}

export class CreateExpenseDto {
  @IsString() @MaxLength(200)
  concept!: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01)
  amount!: number;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  taxAmount?: number;

  @Matches(LOCAL_DATE, { message: 'Formato esperado: YYYY-MM-DD' })
  date!: string;

  @IsOptional() @Matches(LOCAL_DATE, { message: 'Formato esperado: YYYY-MM-DD' })
  dueDate?: string;

  @IsOptional() @IsUUID('4')
  categoryId?: string;

  @IsOptional() @IsUUID('4')
  supplierId?: string;

  @IsOptional() @IsString() @MaxLength(30)
  documentType?: string;

  @IsOptional() @IsString() @MaxLength(50)
  documentNumber?: string;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;
}

export class PayExpenseDto {
  @IsOptional() @IsUUID('4')
  paymentMethodId?: string;

  @IsOptional() @IsUUID('4')
  cashSessionId?: string;

  @IsOptional() @IsUUID('4')
  bankAccountId?: string;
}

export class CreateSupplierDto {
  @IsString() @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(160)
  legalName?: string;

  @IsOptional() @IsString() @MaxLength(20)
  taxId?: string;

  @IsOptional() @IsString() @MaxLength(255)
  email?: string;

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(200)
  address?: string;
}

export class CashFlowDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  days?: number;
}

export class PeriodDto {
  @Matches(LOCAL_DATE, { message: 'Formato esperado: YYYY-MM-DD' })
  from!: string;

  @Matches(LOCAL_DATE, { message: 'Formato esperado: YYYY-MM-DD' })
  to!: string;
}
