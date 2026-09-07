import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentService } from '../../bookings/services/payment.service';
import { IntegrationService } from './integration.service';
import { MercadoPagoClient } from './mercadopago.client';
import { NotificationsService } from '../../notifications/services/notifications.service';
import {
  formatBookingDate,
  formatBookingTime,
  formatMoney,
} from '../../notifications/services/format.util';

/**
 * Orquesta el pago online de una reserva, de punta a punta.
 *
 *   crear orden  →  preferencia en MP  →  jugador paga  →  webhook  →  Payment
 *
 * El pago online es, contablemente, un método que NO afecta el arqueo de caja
 * (la plata cae en la cuenta de MP del club, no en el cajón). Por eso el
 * PaymentMethod de tipo MERCADO_PAGO debe tener affectsCashCount = false.
 * Así reutilizamos TODO el PaymentService existente sin tocarlo.
 */
@Injectable()
export class PaymentOrderService {
  private readonly log = new Logger(PaymentOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly integration: IntegrationService,
    private readonly mp: MercadoPagoClient,
    private readonly payments: PaymentService,
    private readonly notifications: NotificationsService,
  ) {}

  private apiUrl(): string {
    const v = this.config.get<string>('API_PUBLIC_URL');
    if (!v) throw new BadRequestException('Falta API_PUBLIC_URL.');
    return v;
  }
  private webUrl(): string {
    return this.config.get<string>('WEB_PUBLIC_URL') ?? this.apiUrl();
  }

  /**
   * Crea una orden de pago para una reserva y devuelve el link de Checkout Pro.
   * El frontend redirige al jugador a `initPoint`.
   */
  async createForBooking(input: {
    clubId: string;
    bookingId: string;
    createdById?: string | null;
  }): Promise<{ orderId: string; initPoint: string }> {
    const booking = await this.prisma.db.booking.findFirst({
      where: { id: input.bookingId, clubId: input.clubId, deletedAt: null },
      select: {
        id: true,
        clientId: true,
        totalPrice: true,
        paidAmount: true,
        paymentStatus: true,
        status: true,
      },
    });
    if (!booking) throw new NotFoundException('Reserva no encontrada.');

    if (booking.paymentStatus === 'PAID') {
      throw new BadRequestException('La reserva ya está pagada.');
    }

    const due = this.round(
      this.num(booking.totalPrice) - this.num(booking.paidAmount),
    );
    if (due <= 0) throw new BadRequestException('No hay saldo a cobrar.');

    const integration = await this.prisma.db.clubPaymentIntegration.findUnique({
      where: { clubId_provider: { clubId: input.clubId, provider: 'MERCADO_PAGO' } },
      select: { id: true, status: true },
    });
    if (!integration || integration.status !== 'CONNECTED') {
      throw new BadRequestException(
        'El club no tiene Mercado Pago conectado.',
      );
    }

    const externalReference = `clubos:${input.clubId}:booking:${input.bookingId}:${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 30 * 60_000); // 30 min para pagar

    // Orden en estado PENDING antes de hablar con MP: si algo falla después,
    // queda el rastro y un cron puede limpiarla.
    const order = await this.prisma.db.paymentOrder.create({
      data: {
        clubId: input.clubId,
        integrationId: integration.id,
        bookingId: booking.id,
        clientId: booking.clientId,
        amount: due,
        concept: `Reserva ${booking.id.slice(0, 8)}`,
        status: 'PENDING',
        externalReference,
        provider: 'MERCADO_PAGO',
        expiresAt,
        createdById: input.createdById ?? null,
      },
      select: { id: true, concept: true },
    });

    const accessToken = await this.integration.getUsableAccessToken(input.clubId);

    const pref = await this.mp.createPreference(accessToken, {
      clubId: input.clubId,
      externalReference,
      concept: order.concept,
      amount: due,
      currency: 'ARS',
      notificationUrl: `${this.apiUrl()}/payments/mercadopago/webhook?club=${input.clubId}`,
      backUrls: {
        success: `${this.webUrl()}/reservas/${booking.id}?pago=ok`,
        pending: `${this.webUrl()}/reservas/${booking.id}?pago=pendiente`,
        failure: `${this.webUrl()}/reservas/${booking.id}?pago=error`,
      },
      expiresAt,
      bookingId: booking.id,
    });

    await this.prisma.db.paymentOrder.update({
      where: { id: order.id },
      data: { preferenceId: pref.preferenceId, initPoint: pref.initPoint },
    });

    return { orderId: order.id, initPoint: pref.initPoint };
  }

  /**
   * Procesa una notificación de webhook de MP. IDEMPOTENTE.
   *
   * MP no manda el detalle en el webhook: manda un id y hay que consultar el
   * pago. Nunca confiamos en el body para montos/estado — la fuente de verdad
   * es GET /v1/payments/{id} con el token del club.
   *
   * Se llama SOLO después de verificar la firma (en el controller).
   */
  async handleWebhook(input: {
    clubId: string;
    providerPaymentId: string;
  }): Promise<{ handled: boolean; reason?: string }> {
    // 1. Consultar el estado real en MP (con el token del club que cobra).
    const accessToken = await this.integration.getUsableAccessToken(input.clubId);
    const mpPayment = await this.mp.getPayment(accessToken, input.providerPaymentId);

    if (!mpPayment.externalReference) {
      return { handled: false, reason: 'sin external_reference' };
    }

    // 2. Ubicar nuestra orden por la referencia externa.
    const order = await this.prisma.db.paymentOrder.findUnique({
      where: { externalReference: mpPayment.externalReference },
    });
    if (!order) return { handled: false, reason: 'orden no encontrada' };
    if (order.clubId !== input.clubId) {
      // El webhook dice un club, la orden dice otro: no procesar.
      return { handled: false, reason: 'club no coincide' };
    }

    // 3. IDEMPOTENCIA: si ya registramos este payment de MP, salir sin repetir.
    if (order.providerPaymentId === mpPayment.id && order.paymentId) {
      return { handled: true, reason: 'ya procesado' };
    }

    // 4. Mapear estado de MP → nuestro flujo.
    const mapped = this.mapStatus(mpPayment.status);

    if (mapped !== 'APPROVED') {
      // Rechazado / pendiente / en proceso: actualizar estado, no cobrar.
      await this.prisma.db.paymentOrder.update({
        where: { id: order.id },
        data: {
          status: mapped,
          providerPaymentId: mpPayment.id,
          providerStatus: mpPayment.status,
          providerRawWebhook: mpPayment.raw as object,
        },
      });
      return { handled: true, reason: `estado ${mapped}` };
    }

    // 5. APROBADO → registrar el Payment contable, atómicamente.
    //    Toda la escritura (Payment + Booking + AccountEntry) ocurre dentro
    //    de UNA transacción, igual que un cobro en mostrador. Reutiliza el
    //    PaymentService que ya existe.
    await this.prisma.tenantTransaction(async (tx) => {
      // Re-chequear dentro de la tx que nadie lo procesó mientras tanto
      // (dos webhooks en paralelo).
      const fresh = await tx.paymentOrder.findUnique({
        where: { id: order.id },
        select: { paymentId: true, bookingId: true, clientId: true, amount: true, concept: true },
      });
      if (!fresh || fresh.paymentId) return; // ya lo hizo otra ejecución

      const method = await tx.paymentMethod.findFirst({
        where: {
          clubId: input.clubId,
          kind: 'MERCADO_PAGO',
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!method) {
        throw new BadRequestException(
          'El club no tiene un medio de pago Mercado Pago configurado.',
        );
      }

      const result = await this.payments.register(tx, {
        clubId: input.clubId,
        clientId: fresh.clientId,
        bookingId: fresh.bookingId,
        paymentMethodId: method.id,
        amount: this.num(fresh.amount),
        concept: fresh.concept,
        notes: `Mercado Pago · pago ${mpPayment.id}`,
        // Sin cashSessionId: MERCADO_PAGO no afecta caja (affectsCashCount=false),
        // así que register() no pide caja abierta.
      });

      // Enriquecer el Payment con los datos de la pasarela.
      await tx.payment.update({
        where: { id: result.paymentId },
        data: {
          gatewayProvider: 'MERCADO_PAGO',
          gatewayPaymentId: mpPayment.id,
          gatewayStatus: mpPayment.status,
          gatewayRawResponse: mpPayment.raw as object,
        },
      });

      // Actualizar el estado de pago de la reserva.
      if (fresh.bookingId) {
        await this.settleBooking(tx, fresh.bookingId);
      }

      // Cerrar la orden.
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: {
          status: 'APPROVED',
          providerPaymentId: mpPayment.id,
          providerStatus: mpPayment.status,
          providerRawWebhook: mpPayment.raw as object,
          paymentId: result.paymentId,
          approvedAt: new Date(),
        },
      });
    });

    this.log.log(
      `Orden ${order.id} aprobada vía MP (pago ${mpPayment.id}, club ${input.clubId}).`,
    );

    // Notificar al cliente: pago recibido + reserva confirmada. Fuera de la
    // transacción (ya commiteó): si el envío falla, el pago no se revierte.
    // enqueue* solo inserta filas PENDING; el worker las manda.
    try {
      await this.notifyPaymentApproved(order.id);
    } catch (err) {
      this.log.warn(
        `Pago ${mpPayment.id} registrado, pero falló al encolar aviso: ${(err as Error).message}`,
      );
    }

    return { handled: true, reason: 'aprobado y registrado' };
  }

  /**
   * Encola los avisos de un pago aprobado (pago recibido + reserva confirmada).
   * Lee los datos de contacto y de la reserva ya persistidos.
   */
  private async notifyPaymentApproved(orderId: string): Promise<void> {
    const order = await this.prisma.db.paymentOrder.findUnique({
      where: { id: orderId },
      select: {
        clubId: true,
        clientId: true,
        amount: true,
        booking: {
          select: {
            code: true,
            startsAt: true,
            court: { select: { name: true } },
            club: { select: { name: true, timezone: true } },
            client: {
              select: { firstName: true, phone: true, whatsapp: true, email: true },
            },
          },
        },
      },
    });

    if (!order?.booking?.client) return;
    const b = order.booking;
    const client = b.client; // TS: ya garantizado no-null por el guard
    const tz = b.club.timezone ?? 'America/Argentina/Buenos_Aires';
    const data = {
      clubName: b.club.name,
      clientName: client.firstName,
      courtName: b.court.name,
      date: formatBookingDate(b.startsAt, tz),
      time: formatBookingTime(b.startsAt, tz),
      code: b.code,
    };
    const contact = {
      phone: client.phone,
      whatsapp: client.whatsapp,
      email: client.email,
    };

    await this.notifications.enqueuePaymentReceived({
      clubId: order.clubId,
      clientId: order.clientId,
      contact,
      data,
      amount: formatMoney(this.num(order.amount)),
    });
    await this.notifications.enqueueBookingConfirmed({
      clubId: order.clubId,
      clientId: order.clientId,
      contact,
      data,
    });
  }

  /**
   * Recalcula paidAmount / paymentStatus de la reserva a partir de sus pagos.
   * No confía en incrementos: suma la verdad desde la tabla Payment.
   */
  private async settleBooking(tx: any, bookingId: string): Promise<void> {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: { totalPrice: true, status: true },
    });
    if (!booking) return;

    const agg = await tx.payment.aggregate({
      where: { bookingId, status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] } },
      _sum: { amount: true, refundedAmount: true },
    });

    const paid = this.round(
      this.num(agg._sum.amount) - this.num(agg._sum.refundedAmount),
    );
    const total = this.num(booking.totalPrice);

    const paymentStatus =
      paid <= 0 ? 'UNPAID' : paid < total ? 'PARTIAL' : paid > total ? 'OVERPAID' : 'PAID';

    await tx.booking.update({
      where: { id: bookingId },
      data: {
        paidAmount: paid,
        paymentStatus,
        // Confirmar la reserva al pagarse, si estaba pendiente.
        ...(paymentStatus === 'PAID' && booking.status === 'PENDING'
          ? { status: 'CONFIRMED' }
          : {}),
      },
    });
  }

  private mapStatus(mpStatus: string): 'APPROVED' | 'REJECTED' | 'IN_PROCESS' | 'REFUNDED' | 'CANCELLED' {
    switch (mpStatus) {
      case 'approved':
        return 'APPROVED';
      case 'refunded':
      case 'charged_back':
        return 'REFUNDED';
      case 'cancelled':
        return 'CANCELLED';
      case 'in_process':
      case 'pending':
      case 'authorized':
        return 'IN_PROCESS';
      default:
        return 'REJECTED';
    }
  }

  private num(v: unknown): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    return Number((v as { toString(): string }).toString());
  }
  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
