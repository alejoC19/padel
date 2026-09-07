import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsNumber,
  IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested,
} from 'class-validator';

export class SaleItemDto {
  @IsUUID('4')
  productId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;

  /** Precio puntual (promoción). Si se omite, se usa el de lista. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountAmount?: number;
}

export class SalePaymentDto {
  @IsUUID('4')
  paymentMethodId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  /** Con cuánto pagó el cliente, para calcular el vuelto. No se guarda. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tendered?: number;

  @IsOptional()
  @IsUUID('4')
  cashSessionId?: string;
}

export class CreateSaleDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'La venta necesita al menos un producto.' })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items!: SaleItemDto[];

  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  /** Suma el consumo a un turno abierto: se paga todo junto al final. */
  @IsOptional()
  @IsUUID('4')
  bookingId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SalePaymentDto)
  payment?: SalePaymentDto;

  /** Deja el total en cuenta corriente del cliente. */
  @IsOptional()
  @IsBoolean()
  toAccount?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  globalDiscount?: number;
}

export class VoidSaleDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class PurchaseItemDto {
  @IsUUID('4')
  productId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitCost!: number;
}

export class ReceivePurchaseDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items!: PurchaseItemDto[];

  @IsOptional()
  @IsUUID('4')
  supplierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  documentNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class AdjustStockDto {
  /** Lo CONTADO, no la diferencia: el operador cuenta botellas. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  countedQty!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class RegisterLossDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class CreateProductDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salePrice!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  barcode?: string;

  @IsOptional()
  @IsEnum(['GOOD', 'SERVICE', 'RENTAL'])
  kind?: 'GOOD' | 'SERVICE' | 'RENTAL';

  @IsOptional()
  @IsBoolean()
  trackStock?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  initialStock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  minStockQty?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxRate?: number;
}
