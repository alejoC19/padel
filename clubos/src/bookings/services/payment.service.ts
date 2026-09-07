import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DocumentNumberService } from './document-number.service';

export interface RegisterPaymentInput {
  clubId: string;
  clientId?: string | null;
  bookingId?: string | null;
  saleId?: string | null;
  paymentMethodId: string;
  amount: number;
  concept: string;
  notes?: string;
  receivedById?: string | null;
  /** Sesión de caja. Si se omite, se resuelve por la caja del operador. */
  cashSessionId?: string | null;
  /** Membresía del operador: permite ubicar su caja abierta. */
  membershipId?: string | null;
}

export interface PaymentResult {
  paymentId: string;
  code: string;
  amount: number;
  feeAmount: number;
  netAmount: number;
  methodKind: string;
}

/**
 * Registro de pagos.
 *
 * ---------------------------------------------------------------------------
 * QUÉ ESCRIBE UN PAGO
 * ---------------------------------------------------------------------------
 * Un solo cobro toca hasta cuatro tablas, y todas deben cerrar juntas:
 *
 *   1. Payment        — el hecho del cobro, con comisión y neto
 *   2. CashMovement   — solo si el método pasa por caja (efectivo, QR...)
 *   3. AccountEntry   — asiento en cuenta corriente del cliente
 *   4. Booking/Sale   — actualiza paidAmount y paymentStatus
 *
 * Si cualquiera falla, ninguna debe quedar escrita: una caja que no cuadra
 * con los pagos es peor que un cobro fallido, porque el error se descubre
 * recién en el arqueo y ya no se sabe qué pasó.
 *
 * Por eso TODOS los métodos reciben `tx` y nunca abren transacción propia.
 * La transacción la abre el caso de uso (crear reserva y cobrar, vender
 * producto y cobrar), que sabe cuál es la unidad atómica real.
 *
 * ---------------------------------------------------------------------------
 * CUENTA CORRIENTE: SIGNO
 * ---------------------------------------------------------------------------
 *   amount > 0  → a favor del cliente (pagó, o tiene crédito)
 *   amount < 0  → deuda del cliente (se le cargó algo sin pagar)
 *
 * `balanceAfter` se guarda en cada asiento para poder imprimir un extracto
 * sin recalcular toda la historia del cliente.
 * ---------------------------------------------------------------------------
 */
@Injectable()
export class PaymentService {
  constructor(private readonly docNumber: DocumentNumberService) {}

  async register(
    tx: Prisma.TransactionClient,
    input: RegisterPaymentInput,
  ): Promise<PaymentResult> {
    if (input.amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a cero');
    }

    const method = await tx.paymentMethod.findFirst({
      where: { id: input.paymentMethodId, deletedAt: null, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        kind: true,
        feePercent: true,
        feeFixed: true,
        settlementDays: true,
        affectsCashCount: true,
      },
    });

    if (!method) {
      throw new NotFoundException('Medio de pago no encontrado o inactivo');
    }

    // Cuenta corriente no es un cobro: es diferir el cobro. Se maneja
    // como asiento de deuda, no como Payment.
    if (method.kind === 'ACCOUNT_CREDIT') {
      throw new BadRequestException(
        'Cuenta corriente no genera un pago. Usá chargeToAccount().',
      );
    }

    // Los métodos que afectan el arqueo exigen caja abierta. Sin esto, el
    // efectivo entra al sistema pero no al conteo del turno y el cierre
    // muestra una diferencia sin explicación.
    let cashSessionId = input.cashSessionId ?? null;
    if (method.affectsCashCount) {
      cashSessionId = await this.requireOpenSession(
        tx,
        cashSessionId,
        input.membershipId,
      );
    }

    const feeAmount = this.round(
      input.amount * (this.num(method.feePercent) / 100) +
        this.num(method.feeFixed),
    );
    const netAmount = this.round(input.amount - feeAmount);

    const { code } = await this.docNumber.next(tx, input.clubId, 'PAYMENT');

    const settlementDate =
      method.settlementDays > 0
        ? new Date(Date.now() + method.settlementDays * 86_400_000)
        : new Date();

    const payment = await tx.payment.create({
      data: {
        clubId: input.clubId,
        code,
        clientId: input.clientId ?? null,
        bookingId: input.bookingId ?? null,
        saleId: input.saleId ?? null,
        methodId: method.id,
        cashSessionId,
        amount: input.amount,
        feeAmount,
        netAmount,
        status: 'COMPLETED',
        settlementDate,
        // Efectivo se acredita en el acto; el resto queda pendiente hasta
        // la conciliación bancaria.
        settledAt: method.settlementDays === 0 ? new Date() : null,
        notes: input.notes,
        receivedById: input.receivedById ?? null,
      },
      select: { id: true },
    });

    if (method.affectsCashCount && cashSessionId) {
      await tx.cashMovement.create({
        data: {
          clubId: input.clubId,
          sessionId: cashSessionId,
          type: input.bookingId ? 'BOOKING_PAYMENT' : 'PRODUCT_SALE',
          direction: 'IN',
          amount: input.amount,
          paymentMethodId: method.id,
          concept: input.concept,
          reference: input.bookingId ?? input.saleId ?? undefined,
          paymentId: payment.id,
          createdById: input.receivedById ?? null,
        },
      });
    }

    if (input.clientId) {
      await this.appendAccountEntry(tx, {
        clubId: input.clubId,
        clientId: input.clientId,
        type: 'PAYMENT',
        amount: input.amount,
        concept: input.concept,
        bookingId: input.bookingId ?? null,
        saleId: input.saleId ?? null,
        paymentId: payment.id,
        createdById: input.receivedById ?? null,
      });
    }

    return {
      paymentId: payment.id,
      code,
      amount: input.amount,
      feeAmount,
      netAmount,
      methodKind: method.kind,
    };
  }

  /**
   * Carga a cuenta corriente: el cliente se lleva el servicio sin pagar.
   * Genera deuda (asiento negativo), no un Payment.
   */
  async chargeToAccount(
    tx: Prisma.TransactionClient,
    input: {
      clubId: string;
      clientId: string;
      amount: number;
      concept: string;
      bookingId?: string | null;
      saleId?: string | null;
      createdById?: string | null;
      dueDate?: Date | null;
    },
  ): Promise<{ balanceAfter: number }> {
    if (input.amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a cero');
    }

    const client = await tx.client.findFirst({
      where: { id: input.clientId, deletedAt: null },
      select: { accountBalance: true, creditLimit: true, status: true },
    });

    if (!client) throw new NotFoundException('Cliente no encontrado');

    if (client.status === 'BLACKLISTED' || client.status === 'SUSPENDED') {
      throw new ConflictException(
        'El cliente está suspendido y no puede operar a cuenta.',
      );
    }

    const current = this.num(client.accountBalance);
    const limit = this.num(client.creditLimit);
    const after = this.round(current - input.amount);

    // El límite es deuda máxima: saldo no puede bajar de -limit.
    if (after < -limit) {
      throw new ConflictException(
        `Supera el límite de crédito del cliente (disponible: ${this.round(limit + current)}).`,
      );
    }

    await this.appendAccountEntry(tx, {
      clubId: input.clubId,
      clientId: input.clientId,
      type: 'CHARGE',
      amount: -input.amount,
      concept: input.concept,
      bookingId: input.bookingId ?? null,
      saleId: input.saleId ?? null,
      paymentId: null,
      createdById: input.createdById ?? null,
      dueDate: input.dueDate ?? null,
    });

    return { balanceAfter: after };
  }

  /**
   * Reembolso. No borra ni edita el pago original: registra un movimiento
   * inverso. El libro de caja es append-only por diseño.
   */
  async refund(
    tx: Prisma.TransactionClient,
    input: {
      clubId: string;
      paymentId: string;
      amount: number;
      reason: string;
      cashSessionId?: string | null;
      createdById?: string | null;
      membershipId?: string | null;
    },
  ): Promise<{ refundedAmount: number }> {
    const payment = await tx.payment.findFirst({
      where: { id: input.paymentId },
      select: {
        id: true,
        amount: true,
        refundedAmount: true,
        clientId: true,
        bookingId: true,
        status: true,
        method: { select: { id: true, affectsCashCount: true } },
      },
    });

    if (!payment) throw new NotFoundException('Pago no encontrado');
    if (payment.status === 'REFUNDED') {
      throw new ConflictException('El pago ya fue reembolsado en su totalidad');
    }

    const already = this.num(payment.refundedAmount);
    const total = this.num(payment.amount);
    const remaining = this.round(total - already);

    if (input.amount > remaining) {
      throw new BadRequestException(
        `El reembolso excede el saldo del pago (disponible: ${remaining}).`,
      );
    }

    const newRefunded = this.round(already + input.amount);

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        refundedAmount: newRefunded,
        refundedAt: new Date(),
        refundReason: input.reason,
        status: newRefunded >= total ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      },
    });

    if (payment.method.affectsCashCount) {
      const sessionId = await this.requireOpenSession(
        tx,
        input.cashSessionId ?? null,
        input.membershipId ?? null,
      );
      await tx.cashMovement.create({
        data: {
          clubId: input.clubId,
          sessionId,
          type: 'REFUND',
          direction: 'OUT',
          amount: input.amount,
          paymentMethodId: payment.method.id,
          concept: `Reembolso: ${input.reason}`,
          reference: payment.bookingId ?? undefined,
          paymentId: payment.id,
          createdById: input.createdById ?? null,
        },
      });
    }

    if (payment.clientId) {
      await this.appendAccountEntry(tx, {
        clubId: input.clubId,
        clientId: payment.clientId,
        type: 'REFUND',
        amount: -input.amount,
        concept: `Reembolso: ${input.reason}`,
        bookingId: payment.bookingId,
        saleId: null,
        paymentId: payment.id,
        createdById: input.createdById ?? null,
      });
    }

    return { refundedAmount: newRefunded };
  }

  /**
   * Asiento en cuenta corriente + actualización del saldo cacheado.
   *
   * El saldo del cliente es un cache de la suma de asientos. Se actualiza
   * en la misma transacción para que nunca puedan divergir.
   */
  private async appendAccountEntry(
    tx: Prisma.TransactionClient,
    input: {
      clubId: string;
      clientId: string;
      type: string;
      amount: number;
      concept: string;
      bookingId: string | null;
      saleId: string | null;
      paymentId: string | null;
      createdById: string | null;
      dueDate?: Date | null;
    },
  ): Promise<number> {
    // El UPDATE ... RETURNING toma lock de la fila del cliente, serializando
    // asientos concurrentes del mismo cliente. Sin esto, dos cobros
    // simultáneos podrían leer el mismo saldo previo y escribir
    // balanceAfter incorrectos.
    const updated = await tx.client.update({
      where: { id: input.clientId },
      data: { accountBalance: { increment: input.amount } },
      select: { accountBalance: true },
    });

    const balanceAfter = this.round(this.num(updated.accountBalance));

    await tx.accountEntry.create({
      data: {
        clubId: input.clubId,
        clientId: input.clientId,
        type: input.type as never,
        amount: input.amount,
        balanceAfter,
        concept: input.concept,
        bookingId: input.bookingId,
        saleId: input.saleId,
        paymentId: input.paymentId,
        dueDate: input.dueDate ?? null,
        createdById: input.createdById,
      },
    });

    return balanceAfter;
  }

  /**
   * Resuelve en qué caja registrar el cobro.
   *
   * Orden de preferencia:
   *   1. La caja indicada explícitamente
   *   2. La caja abierta del propio operador
   *   3. La única caja abierta del club
   *
   * El paso 2 es el que importa en la práctica: con dos puestos abiertos
   * (recepción y buffet), sin él todo cobro fallaría pidiendo desambiguar.
   * El cobro debe caer en la caja de quien lo está cobrando.
   */
  private async requireOpenSession(
    tx: Prisma.TransactionClient,
    provided: string | null,
    membershipId?: string | null,
  ): Promise<string> {
    if (provided) {
      const s = await tx.cashSession.findFirst({
        where: { id: provided, status: 'OPEN' },
        select: { id: true },
      });
      if (!s) {
        throw new ConflictException(
          'La caja indicada no está abierta.',
        );
      }
      return s.id;
    }

    if (membershipId) {
      const own = await tx.cashSession.findFirst({
        where: { membershipId, status: 'OPEN' },
        select: { id: true },
      });
      if (own) return own.id;
    }

    const open = await tx.cashSession.findMany({
      where: { status: 'OPEN' },
      select: { id: true },
      take: 2,
    });

    if (open.length === 0) {
      throw new ConflictException(
        'No hay una caja abierta. Abrí la caja antes de cobrar en efectivo.',
      );
    }
    if (open.length > 1) {
      throw new ConflictException(
        'Hay varias cajas abiertas y no tenés una propia. ' +
          'Indicá en cuál registrar el cobro.',
      );
    }
    return open[0].id;
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
