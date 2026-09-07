import { IsOptional, IsString, IsUUID } from 'class-validator';

/** Body para crear una orden de pago online de una reserva. */
export class CreateBookingOrderDto {
  @IsUUID()
  bookingId!: string;
}

/** Query params del callback de OAuth de Mercado Pago. */
export class OAuthCallbackDto {
  @IsString()
  code!: string;

  @IsString()
  state!: string;
}
