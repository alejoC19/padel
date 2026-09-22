import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from './availability.service';
import { PricingService } from './pricing.service';
import { ClubConfigService } from './club-config.service';
import { PaymentService } from './payment.service';
import { DocumentNumberService } from './document-number.service';
import {
  calculateNoShowCharge,
  calculateRefund,
  parsePolicy,
} from '../cancellation-policy';
import type {
  CancelBookingDto,
  CreateBookingDto,
  RescheduleBookingDto,
} from '../dto/booking.dto';
import { NotificationsService } from '../../notifications/services/notifications.service';
import {
  formatBookingDate,
  formatBookingTime,
  formatMoney,
} from '../../notifications/services/format.util';

/** Estados desde los que ya no se puede operar. */
const TERMINAL_STATUSES = [
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_CLUB',
  'NO_SHOW',
  'RESCHEDULED',
  'COMPLETED',
];

/**
 * Estados en los que `collect()` NO debe aceptar un cobro nuevo.
 *
 * A propósito es un subconjunto de `TERMINAL_STATUSES`, sin `COMPLETED`: es
 * normal que el cliente pague recién al terminar de jugar, así que cobrar
 * después del check-out sigue siendo válido.
 *
 * Los otros cuatro sí tienen que bloquearse: `totalPrice`/`paidAmount` de la
 * reserva no cambian al cancelarla o marcarla ausente (lo que cambia es
 * `cancellationFee`/el cargo a cuenta corriente, calculados aparte), así que
 * sin este freno `collect()` deja cobrar hasta el precio ORIGINAL completo
 * de una reserva cancelada — muy por encima de lo que la política de
 * cancelación dice que corresponde. Para `RESCHEDULED`, la reserva vigente
 * es la nueva; cobrar sobre la vieja cobra contra un turno que ya no existe.
 */
const UNCOLLECTIBLE_STATUSES = [
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_CLUB',
  'NO_SHOW',
  'RESCHEDULED',
];

@Injectable()
export class BookingService {
  private readonly log = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly pricing: PricingService,
    private readonly config: ClubConfigService,
    private readonly payments: PaymentService,
    private readonly docNumber: DocumentNumberService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Crea una reserva y, si corresponde, la cobra.
   *
   * -------------------------------------------------------------------------
   * TODO EN UNA TRANSACCIÓN
   * -------------------------------------------------------------------------
   * Booking + Payment + CashMovement + AccountEntry + agregados del cliente
   * se escriben juntos o no se escribe nada. El caso que hay que evitar:
   * reserva creada y cobro perdido, o cobro registrado sin reserva.
   *
   * -------------------------------------------------------------------------
   * LA DISPONIBILIDAD LA DECIDE POSTGRES
   * -------------------------------------------------------------------------
   * El pre-chequeo con isSlotFree() existe solo para dar un mensaje claro
   * temprano. La garantía real es el EXCLUDE constraint: si entre el chequeo
   * y el INSERT alguien reservó, el motor rechaza y el filtro lo traduce a
   * 409 BOOKING_OVERLAP. Confiar en el chequeo previo sería reintroducir la
   * condición de carrera.
   * -------------------------------------------------------------------------
   */
  async create(
    dto: CreateBookingDto,
    clubId: string,
    userId: string,
    membershipId?: string | null,
  ): Promise<{ id: string; code: string; totalPrice: number; paidAmount: number }> {
    const tz = await this.config.timezone(clubId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(startsAt.getTime() + dto.durationMinutes * 60_000);

    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('Fecha de inicio inválida');
    }

    // Reservar en el pasado solo se permite con permiso de override
    // (recepción cargando un turno que ya se jugó).
    if (endsAt <= new Date() && !dto.allowPast) {
      throw new BadRequestException(
        'No se puede reservar un horario que ya pasó.',
      );
    }

    const court = await this.prisma.db.court.findFirst({
      where: { id: dto.courtId, deletedAt: null },
      select: { id: true, status: true, capacity: true, name: true },
    });

    if (!court) throw new NotFoundException('Cancha no encontrada');
    if (court.status !== 'AVAILABLE') {
      throw new ConflictException(
        `La cancha ${court.name} no está disponible (${court.status}).`,
      );
    }

    const withinHours = await this.availability.isWithinOperatingHours(
      dto.courtId,
      startsAt,
      endsAt,
      tz,
    );
    if (!withinHours && !dto.allowOutsideHours) {
      throw new ConflictException(
        'El horario está fuera del horario de apertura del club.',
      );
    }

    const free = await this.availability.isSlotFree(
      dto.courtId,
      startsAt,
      endsAt,
    );
    if (!free) {
      throw new ConflictException(
        'Ese horario ya está ocupado en esta cancha.',
      );
    }

    const quote = dto.overridePrice
      ? {
          basePrice: dto.overridePrice,
          discountAmount: 0,
          totalPrice: dto.overridePrice,
        }
      : await this.pricing.quote({
          courtId: dto.courtId,
          startsAt,
          durationMinutes: dto.durationMinutes,
          bookingType: dto.type ?? 'REGULAR',
          clientId: dto.clientId ?? null,
          timezone: tz,
        });

    const result = await this.prisma.tenantTransaction(async (tx) => {
      const { code } = await this.docNumber.next(tx, clubId, 'BOOKING');

      const booking = await tx.booking.create({
        data: {
          clubId,
          code,
          courtId: dto.courtId,
          clientId: dto.clientId ?? null,
          instructorId: dto.instructorId ?? null,
          type: (dto.type ?? 'REGULAR') as never,
          status: 'PENDING',
          startsAt,
          endsAt,
          durationMinutes: dto.durationMinutes,
          playersCount: dto.playersCount ?? court.capacity,
          basePrice: quote.basePrice,
          discountAmount: quote.discountAmount,
          totalPrice: quote.totalPrice,
          paidAmount: 0,
          paymentStatus: 'UNPAID',
          notes: dto.notes,
          internalNotes: dto.internalNotes,
          source: (dto.source ?? 'ADMIN') as never,
          createdById: userId,
        },
        select: { id: true, code: true },
      });

      await tx.bookingStatusChange.create({
        data: {
          clubId,
          bookingId: booking.id,
          fromStatus: null,
          toStatus: 'PENDING',
          changedById: userId,
        },
      });

      // Jugadores (titular + invitados).
      if (dto.players?.length) {
        await tx.bookingPlayer.createMany({
          data: dto.players.map((p, i) => ({
            clubId,
            bookingId: booking.id,
            clientId: p.clientId ?? null,
            guestName: p.guestName ?? null,
            guestPhone: p.guestPhone ?? null,
            guestEmail: p.guestEmail ?? null,
            isOrganizer: i === 0 && !p.clientId ? false : p.isOrganizer ?? false,
            shareAmount: p.shareAmount ?? 0,
          })),
        });
      }

      let paidAmount = 0;

      if (dto.payment && dto.payment.amount > 0) {
        if (dto.payment.amount > quote.totalPrice) {
          throw new BadRequestException(
            'El pago no puede superar el total de la reserva.',
          );
        }

        if (dto.payment.toAccount) {
          if (!dto.clientId) {
            throw new BadRequestException(
              'Para cargar a cuenta corriente se requiere un cliente.',
            );
          }
          await this.payments.chargeToAccount(tx, {
            clubId,
            clientId: dto.clientId,
            amount: quote.totalPrice,
            concept: `Reserva ${code} - ${court.name}`,
            bookingId: booking.id,
            createdById: userId,
          });
        } else {
          await this.payments.register(tx, {
            clubId,
            clientId: dto.clientId ?? null,
            bookingId: booking.id,
            paymentMethodId: dto.payment.paymentMethodId!,
            amount: dto.payment.amount,
            concept: `Reserva ${code} - ${court.name}`,
            cashSessionId: dto.payment.cashSessionId ?? null,
            membershipId,
            receivedById: userId,
          });
          paidAmount = dto.payment.amount;
        }
      }

      const paymentStatus = this.resolvePaymentStatus(
        paidAmount,
        quote.totalPrice,
      );
      const status = paymentStatus === 'PAID' ? 'PAID' : 'CONFIRMED';

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          paidAmount,
          paymentStatus: paymentStatus as never,
          status: status as never,
          confirmedAt: new Date(),
        },
      });

      await tx.bookingStatusChange.create({
        data: {
          clubId,
          bookingId: booking.id,
          fromStatus: 'PENDING',
          toStatus: status as never,
          changedById: userId,
        },
      });

      if (dto.clientId) {
        await this.bumpClientAggregates(tx, dto.clientId, quote.totalPrice);
      }

      await this.audit(tx, clubId, userId, 'CREATE', booking.id, {
        code,
        startsAt: startsAt.toISOString(),
        totalPrice: quote.totalPrice,
      });

      return {
        id: booking.id,
        code: booking.code,
        totalPrice: quote.totalPrice,
        paidAmount,
      };
    });

    // Fuera de la transacción (ya commiteó): si falla el envío, la reserva
    // ya está creada y no hay nada que revertir — solo se pierde el aviso.
    // Cubre tanto una reserva de mostrador como una del portal público
    // (PublicService.reservar() llama a este mismo create()).
    try {
      await this.notifyBookingConfirmed(result.id);
    } catch (err) {
      this.log.warn(
        `Reserva ${result.code} creada, pero falló al encolar el aviso: ${(err as Error).message}`,
      );
    }

    return result;
  }

  /**
   * Cancela una reserva y procesa la devolución según la política del club.
   *
   * `autoRefund` (default true) controla si la devolución se EJECUTA acá
   * mismo (Payment.refundedAmount, movimiento de caja si corresponde, asiento
   * en cuenta corriente) o solo se CALCULA. El portal público la llama con
   * `autoRefund: false`: un jugador cancelando desde el celular no puede
   * disparar una salida de caja real sin que nadie del club esté presente
   * para entregar la plata, y para un pago online tampoco existe ninguna
   * llamada al reembolso real de Mercado Pago en el sistema — marcarlo como
   * "reembolsado" acá sería mentirle a la contabilidad. El monto calculado
   * queda igual en `refundAmount` de la reserva y en un asiento de auditoría,
   * para que el club lo vea y lo procese a mano.
   */
  async cancel(
    bookingId: string,
    dto: CancelBookingDto,
    clubId: string,
    userId: string,
    membershipId?: string | null,
    options?: { autoRefund?: boolean },
  ): Promise<{ refundAmount: number; cancellationFee: number; tierApplied: string }> {
    const autoRefund = options?.autoRefund ?? true;
    const club = await this.config.get(clubId);
    const policy = parsePolicy(club.settings);

    const result = await this.prisma.tenantTransaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, deletedAt: null },
        select: {
          id: true,
          code: true,
          status: true,
          startsAt: true,
          clientId: true,
          totalPrice: true,
          paidAmount: true,
          payments: {
            where: { status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] } },
            select: {
              id: true, amount: true, refundedAmount: true,
              gatewayProvider: true, method: { select: { kind: true } },
            },
            orderBy: { paidAt: 'asc' },
          },
        },
      });

      if (!booking) throw new NotFoundException('Reserva no encontrada');
      if (TERMINAL_STATUSES.includes(booking.status)) {
        throw new ConflictException(
          `La reserva ya está en estado ${booking.status} y no puede cancelarse.`,
        );
      }

      const paid = this.num(booking.paidAmount);
      const calc = calculateRefund(
        policy,
        booking.startsAt,
        paid,
        dto.cancelledBy ?? 'CLIENT',
      );

      // Reembolsos contra los pagos originales, del más viejo al más nuevo.
      // Repartir así mantiene la trazabilidad: cada devolución queda ligada
      // al cobro que la originó, que es lo que pide una auditoría.
      let pending = calc.refundAmount;
      if (autoRefund) {
        for (const p of booking.payments) {
          if (pending <= 0) break;
          const available = this.num(p.amount) - this.num(p.refundedAmount);
          if (available <= 0) continue;
          // Pago de Mercado Pago: ClubOS no llama a la API real de MP para
          // devolver la plata (ver el comentario de PaymentService.refund),
          // así que este cobro NO se marca reembolsado acá — queda como
          // saldo pendiente (cae en el aviso de faltante de abajo) para que
          // el club lo procese a mano desde su panel de MP.
          const isMercadoPago =
            p.gatewayProvider === 'MERCADO_PAGO' || p.method.kind === 'MERCADO_PAGO';
          if (isMercadoPago) continue;
          const take = Math.min(available, pending);
          await this.payments.refund(tx, {
            clubId,
            paymentId: p.id,
            amount: take,
            reason: dto.reason ?? 'Cancelación de reserva',
            cashSessionId: dto.cashSessionId ?? null,
            membershipId,
            createdById: userId,
          });
          pending = this.round(pending - take);
        }
      }

      // `refundAmount` se calcula sobre `paidAmount`, así que normalmente
      // los pagos alcanzan a cubrirlo. Si no alcanzan, `paidAmount` y los
      // Payment reales divergieron (dato corrupto o migración incompleta).
      // Se registra lo efectivamente devuelto, no lo teórico: la reserva
      // no debe afirmar que devolvió plata que nunca salió de la caja.
      const actuallyRefunded = autoRefund ? this.round(calc.refundAmount - pending) : 0;
      if (!autoRefund && calc.refundAmount > 0) {
        await this.audit(tx, clubId, userId, 'UPDATE', booking.id, {
          action: 'REFUND_PENDING_MANUAL',
          amount: calc.refundAmount,
          note: 'Cancelación del jugador vía portal público: el reembolso no se ejecutó, queda a cargo del club procesarlo.',
        });
      } else if (pending > 0) {
        await this.audit(tx, clubId, userId, 'UPDATE', booking.id, {
          action: 'REFUND_SHORTFALL',
          expected: calc.refundAmount,
          refunded: actuallyRefunded,
          shortfall: pending,
        });
      }

      const newStatus =
        (dto.cancelledBy ?? 'CLIENT') === 'CLUB'
          ? 'CANCELLED_BY_CLUB'
          : 'CANCELLED_BY_CLIENT';

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: newStatus as never,
          cancelledAt: new Date(),
          cancelledById: userId,
          cancellationReason: dto.reason,
          cancellationFee: calc.cancellationFee,
          refundAmount: autoRefund ? actuallyRefunded : calc.refundAmount,
        },
      });

      await tx.bookingStatusChange.create({
        data: {
          clubId,
          bookingId: booking.id,
          fromStatus: booking.status as never,
          toStatus: newStatus as never,
          reason: dto.reason,
          changedById: userId,
        },
      });

      if (booking.clientId) {
        await tx.client.update({
          where: { id: booking.clientId },
          data: {
            cancellationsCount: { increment: 1 },
            // Revertir el gasto: la reserva ya no cuenta como consumo.
            totalSpent: { decrement: this.num(booking.totalPrice) },
            bookingsCount: { decrement: 1 },
          },
        });
      }

      await this.audit(tx, clubId, userId, 'UPDATE', booking.id, {
        action: 'CANCEL',
        refundAmount: calc.refundAmount,
        tierApplied: calc.tierApplied,
      });

      return {
        refundAmount: actuallyRefunded,
        cancellationFee: calc.cancellationFee,
        tierApplied: calc.tierApplied,
      };
    });

    try {
      await this.notifyBookingCancelled(bookingId);
    } catch (err) {
      this.log.warn(
        `Reserva ${bookingId} cancelada, pero falló al encolar el aviso: ${(err as Error).message}`,
      );
    }

    return result;
  }

  /**
   * Reprogramación: cancela la original y crea una nueva encadenada.
   *
   * No se edita la reserva in situ. El historial de "cuándo se movió, de
   * dónde a dónde y quién lo hizo" es lo que permite resolver una disputa
   * con un cliente tres semanas después.
   */
  async reschedule(
    bookingId: string,
    dto: RescheduleBookingDto,
    clubId: string,
    userId: string,
  ): Promise<{ newBookingId: string; newCode: string }> {
    const tz = await this.config.timezone(clubId);
    const startsAt = new Date(dto.startsAt);

    const result = await this.prisma.tenantTransaction(async (tx) => {
      const original = await tx.booking.findFirst({
        where: { id: bookingId, deletedAt: null },
        select: {
          id: true,
          code: true,
          status: true,
          courtId: true,
          clientId: true,
          instructorId: true,
          type: true,
          durationMinutes: true,
          playersCount: true,
          basePrice: true,
          discountAmount: true,
          totalPrice: true,
          paidAmount: true,
          paymentStatus: true,
          notes: true,
          accessTokenHash: true,
        },
      });

      if (!original) throw new NotFoundException('Reserva no encontrada');
      if (TERMINAL_STATUSES.includes(original.status)) {
        throw new ConflictException(
          `No se puede reprogramar una reserva en estado ${original.status}.`,
        );
      }

      const courtId = dto.courtId ?? original.courtId;
      const duration = dto.durationMinutes ?? original.durationMinutes;
      const endsAt = new Date(startsAt.getTime() + duration * 60_000);

      const within = await this.availability.isWithinOperatingHours(
        courtId,
        startsAt,
        endsAt,
        tz,
      );
      if (!within && !dto.allowOutsideHours) {
        throw new ConflictException(
          'El nuevo horario está fuera del horario de apertura.',
        );
      }

      const { code } = await this.docNumber.next(tx, clubId, 'BOOKING');

      // accessTokenHash es @unique: hay que liberarlo de la original ANTES
      // de crear la nueva con el mismo valor, o el INSERT choca. Se
      // transfiere (no se genera uno nuevo) para que el link/comprobante que
      // el jugador ya tiene guardado siga funcionando tal cual — ver
      // PublicService.resolveLiveBookingId(), que sigue la cadena de
      // `rescheduledFromId` para resolver siempre a la reserva vigente.
      if (original.accessTokenHash) {
        await tx.booking.update({
          where: { id: original.id },
          data: { accessTokenHash: null },
        });
      }

      // El precio y lo pagado se trasladan tal cual: reprogramar no es
      // recotizar. Si el club quiere cobrar la diferencia por mover a un
      // horario más caro, es una decisión comercial que se registra aparte.
      const created = await tx.booking.create({
        data: {
          clubId,
          code,
          courtId,
          clientId: original.clientId,
          instructorId: original.instructorId,
          type: original.type,
          status: original.paymentStatus === 'PAID' ? 'PAID' : 'CONFIRMED',
          startsAt,
          endsAt,
          durationMinutes: duration,
          playersCount: original.playersCount,
          basePrice: original.basePrice,
          discountAmount: original.discountAmount,
          totalPrice: original.totalPrice,
          paidAmount: original.paidAmount,
          paymentStatus: original.paymentStatus,
          notes: original.notes,
          source: 'ADMIN',
          createdById: userId,
          rescheduledFromId: original.id,
          accessTokenHash: original.accessTokenHash,
          confirmedAt: new Date(),
        },
        select: { id: true, code: true },
      });

      await tx.booking.update({
        where: { id: original.id },
        data: {
          status: 'RESCHEDULED',
          cancelledAt: new Date(),
          cancelledById: userId,
          cancellationReason: dto.reason ?? 'Reprogramada',
        },
      });

      await tx.bookingStatusChange.createMany({
        data: [
          {
            clubId,
            bookingId: original.id,
            fromStatus: original.status as never,
            toStatus: 'RESCHEDULED' as never,
            reason: dto.reason,
            changedById: userId,
          },
          {
            clubId,
            bookingId: created.id,
            fromStatus: null,
            toStatus: 'CONFIRMED' as never,
            reason: `Reprogramada desde ${original.code}`,
            changedById: userId,
          },
        ],
      });

      // Los pagos siguen a la reserva nueva para que el historial de cobro
      // no quede colgando de una reserva que ya no existe operativamente.
      await tx.payment.updateMany({
        where: { bookingId: original.id },
        data: { bookingId: created.id },
      });

      await this.audit(tx, clubId, userId, 'UPDATE', original.id, {
        action: 'RESCHEDULE',
        from: original.code,
        to: created.code,
      });

      return { newBookingId: created.id, newCode: created.code };
    });

    // Fuera de la transacción, mismo criterio que create()/cancel(): si
    // falla el aviso, la reprogramación ya está hecha y no hay nada que
    // revertir por eso. Reusa la plantilla de confirmación (no hay una
    // dedicada a "reprogramada") — el jugador necesita sobre todo el
    // horario nuevo, que ese aviso ya comunica bien.
    try {
      await this.notifyBookingConfirmed(result.newBookingId);
    } catch (err) {
      this.log.warn(
        `Reserva ${result.newCode} reprogramada, pero falló al encolar el aviso: ${(err as Error).message}`,
      );
    }

    return result;
  }

  /** Registra la llegada del cliente. */
  async checkIn(bookingId: string, clubId: string, userId: string) {
    return this.transition(bookingId, clubId, userId, {
      allowedFrom: ['CONFIRMED', 'PAID', 'PENDING'],
      to: 'IN_PROGRESS',
      data: { checkInAt: new Date() },
      clientUpdate: { lastVisitAt: new Date() },
    });
  }

  /** Cierra la reserva al terminar el turno. */
  async checkOut(bookingId: string, clubId: string, userId: string) {
    return this.transition(bookingId, clubId, userId, {
      allowedFrom: ['IN_PROGRESS', 'CONFIRMED', 'PAID'],
      to: 'COMPLETED',
      data: { checkOutAt: new Date() },
    });
  }

  /**
   * Marca ausencia. Según la política, puede dejar deuda en cuenta
   * corriente por el turno no usado.
   */
  async markNoShow(
    bookingId: string,
    clubId: string,
    userId: string,
    reason?: string,
  ): Promise<{ charged: number }> {
    const club = await this.config.get(clubId);
    const policy = parsePolicy(club.settings);

    return this.prisma.tenantTransaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, deletedAt: null },
        select: {
          id: true,
          code: true,
          status: true,
          clientId: true,
          totalPrice: true,
          paidAmount: true,
        },
      });

      if (!booking) throw new NotFoundException('Reserva no encontrada');
      if (TERMINAL_STATUSES.includes(booking.status)) {
        throw new ConflictException(
          `La reserva está en estado ${booking.status}.`,
        );
      }

      const charge = calculateNoShowCharge(
        policy,
        this.num(booking.totalPrice),
        this.num(booking.paidAmount),
      );

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'NO_SHOW',
          noShowAt: new Date(),
          noShowReason: reason,
        },
      });

      await tx.bookingStatusChange.create({
        data: {
          clubId,
          bookingId: booking.id,
          fromStatus: booking.status as never,
          toStatus: 'NO_SHOW' as never,
          reason,
          changedById: userId,
        },
      });

      // Si quedó saldo impago y la política lo cobra, se carga a cuenta.
      if (booking.clientId && charge.pendingAmount > 0) {
        await this.payments.chargeToAccount(tx, {
          clubId,
          clientId: booking.clientId,
          amount: charge.pendingAmount,
          concept: `Ausencia sin aviso - Reserva ${booking.code}`,
          bookingId: booking.id,
          createdById: userId,
        });
      }

      if (booking.clientId) {
        await tx.client.update({
          where: { id: booking.clientId },
          data: { noShowCount: { increment: 1 } },
        });
      }

      await this.audit(tx, clubId, userId, 'UPDATE', booking.id, {
        action: 'NO_SHOW',
        charged: charge.pendingAmount,
      });

      return { charged: charge.pendingAmount };
    });
  }

  /** Cobro posterior a la creación (el cliente paga el saldo al llegar). */
  async collect(
    bookingId: string,
    input: {
      paymentMethodId: string;
      amount: number;
      cashSessionId?: string | null;
    },
    clubId: string,
    userId: string,
    membershipId?: string | null,
  ): Promise<{ paidAmount: number; paymentStatus: string }> {
    return this.prisma.tenantTransaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, deletedAt: null },
        select: {
          id: true,
          code: true,
          status: true,
          clientId: true,
          totalPrice: true,
          paidAmount: true,
          court: { select: { name: true } },
        },
      });

      if (!booking) throw new NotFoundException('Reserva no encontrada');
      if (UNCOLLECTIBLE_STATUSES.includes(booking.status)) {
        throw new ConflictException(
          `La reserva está en estado ${booking.status} y no admite más cobros.`,
        );
      }

      const total = this.num(booking.totalPrice);
      const already = this.num(booking.paidAmount);
      const remaining = this.round(total - already);

      if (remaining <= 0) {
        throw new ConflictException('La reserva ya está totalmente pagada.');
      }
      if (input.amount > remaining) {
        throw new BadRequestException(
          `El monto supera el saldo pendiente (${remaining}).`,
        );
      }

      await this.payments.register(tx, {
        clubId,
        clientId: booking.clientId,
        bookingId: booking.id,
        paymentMethodId: input.paymentMethodId,
        amount: input.amount,
        concept: `Reserva ${booking.code} - ${booking.court.name}`,
        cashSessionId: input.cashSessionId ?? null,
        membershipId,
        receivedById: userId,
      });

      const paidAmount = this.round(already + input.amount);
      const paymentStatus = this.resolvePaymentStatus(paidAmount, total);

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          paidAmount,
          paymentStatus: paymentStatus as never,
          ...(paymentStatus === 'PAID' && booking.status === 'CONFIRMED'
            ? { status: 'PAID' as never }
            : {}),
        },
      });

      return { paidAmount, paymentStatus };
    });
  }

  // --- internos ---

  private async transition(
    bookingId: string,
    clubId: string,
    userId: string,
    opts: {
      allowedFrom: string[];
      to: string;
      data: Record<string, unknown>;
      clientUpdate?: Record<string, unknown>;
    },
  ) {
    return this.prisma.tenantTransaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, deletedAt: null },
        select: { id: true, status: true, clientId: true },
      });

      if (!booking) throw new NotFoundException('Reserva no encontrada');
      if (!opts.allowedFrom.includes(booking.status)) {
        throw new ConflictException(
          `No se puede pasar de ${booking.status} a ${opts.to}.`,
        );
      }

      await tx.booking.update({
        where: { id: booking.id },
        data: { status: opts.to as never, ...opts.data },
      });

      await tx.bookingStatusChange.create({
        data: {
          clubId,
          bookingId: booking.id,
          fromStatus: booking.status as never,
          toStatus: opts.to as never,
          changedById: userId,
        },
      });

      if (opts.clientUpdate && booking.clientId) {
        await tx.client.update({
          where: { id: booking.clientId },
          data: opts.clientUpdate as never,
        });
      }

      return { id: booking.id, status: opts.to };
    });
  }

  private async bumpClientAggregates(
    tx: Prisma.TransactionClient,
    clientId: string,
    amount: number,
  ): Promise<void> {
    await tx.client.update({
      where: { id: clientId },
      data: {
        bookingsCount: { increment: 1 },
        totalSpent: { increment: amount },
        lastBookingAt: new Date(),
      },
    });
  }

  /**
   * Encola el aviso de confirmación de una reserva recién creada.
   * Cubre tanto el mostrador como el portal público (mismo `create()`).
   * Silencioso si la reserva no tiene cliente o el cliente no tiene contacto
   * — eso ya lo resuelve `NotificationsService.enqueue`.
   */
  private async notifyBookingConfirmed(bookingId: string): Promise<void> {
    const data = await this.loadNotificationData(bookingId);
    if (!data) return;
    await this.notifications.enqueueBookingConfirmed({
      clubId: data.clubId,
      clientId: data.clientId,
      contact: data.contact,
      data: data.bookingData,
    });
  }

  /** Encola el aviso de cancelación. Mismo criterio que la confirmación. */
  private async notifyBookingCancelled(bookingId: string): Promise<void> {
    const data = await this.loadNotificationData(bookingId);
    if (!data) return;
    await this.notifications.enqueueBookingCancelled({
      clubId: data.clubId,
      clientId: data.clientId,
      contact: data.contact,
      data: data.bookingData,
    });
  }

  /**
   * Lee (fuera de la transacción, ya commiteada) lo que necesita un mensaje
   * de reserva: cliente + contacto + cancha + club + fecha/hora formateadas
   * en el huso del club. `null` si la reserva no tiene cliente asociado (no
   * hay a quién avisarle) — mismo camino silencioso que un walk-in sin datos.
   */
  private async loadNotificationData(bookingId: string): Promise<{
    clubId: string;
    clientId: string;
    contact: { phone: string | null; whatsapp: string | null; email: string | null };
    bookingData: {
      clubName: string; clientName: string; courtName: string; date: string; time: string;
      code: string; totalPrice: string; paymentStatusLabel: string;
    };
  } | null> {
    const booking = await this.prisma.db.booking.findUnique({
      where: { id: bookingId },
      select: {
        clubId: true,
        code: true,
        startsAt: true,
        totalPrice: true,
        paymentStatus: true,
        court: { select: { name: true } },
        club: { select: { name: true, timezone: true } },
        client: {
          select: { id: true, firstName: true, phone: true, whatsapp: true, email: true },
        },
      },
    });
    if (!booking?.client) return null;

    const tz = booking.club.timezone ?? 'America/Argentina/Buenos_Aires';
    const paymentStatusLabel: Record<string, string> = {
      UNPAID: 'sin pagar', PARTIAL: 'pago parcial', PAID: 'pagada', OVERPAID: 'pagada',
    };
    return {
      clubId: booking.clubId,
      clientId: booking.client.id,
      contact: {
        phone: booking.client.phone,
        whatsapp: booking.client.whatsapp,
        email: booking.client.email,
      },
      bookingData: {
        clubName: booking.club.name,
        clientName: booking.client.firstName,
        courtName: booking.court.name,
        date: formatBookingDate(booking.startsAt, tz),
        time: formatBookingTime(booking.startsAt, tz),
        code: booking.code,
        totalPrice: formatMoney(this.num(booking.totalPrice)),
        paymentStatusLabel: paymentStatusLabel[booking.paymentStatus] ?? booking.paymentStatus,
      },
    };
  }

  private resolvePaymentStatus(paid: number, total: number): string {
    if (paid <= 0) return 'UNPAID';
    if (paid >= total) return paid > total ? 'OVERPAID' : 'PAID';
    return 'PARTIAL';
  }

  private async audit(
    tx: Prisma.TransactionClient,
    clubId: string,
    userId: string,
    action: string,
    entityId: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        clubId,
        userId,
        action: action as never,
        entityType: 'Booking',
        entityId,
        changes: changes as never,
      },
    });
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
