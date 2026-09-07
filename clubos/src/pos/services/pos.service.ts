import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentService } from '../../bookings/services/payment.service';
import { DocumentNumberService } from '../../bookings/services/document-number.service';
import { StockService } from './stock.service';
import type { CreateSaleDto } from '../dto/pos.dto';

/**
 * Punto de venta del buffet.
 *
 * ---------------------------------------------------------------------------
 * QUÉ TOCA UNA VENTA
 * ---------------------------------------------------------------------------
 * Vender una Coca escribe en cinco lugares, y todos tienen que cerrar juntos:
 *
 *   1. Sale + SaleItem   — qué se vendió y a qué precio
 *   2. StockMovement     — baja del inventario, con su saldo
 *   3. Payment           — el cobro, con su comisión
 *   4. CashMovement      — entrada a la caja del turno
 *   5. AccountEntry      — si va a cuenta corriente del socio
 *
 * Si una falla, no se escribe ninguna. El caso a evitar: stock descontado y
 * cobro perdido — el inventario dice que se vendió y la caja no lo tiene.
 *
 * ---------------------------------------------------------------------------
 * PRECIOS CONGELADOS
 * ---------------------------------------------------------------------------
 * `SaleItem` guarda descripción y precio unitario copiados del producto, no
 * una referencia. Si mañana la Coca sube, la venta de ayer tiene que seguir
 * diciendo lo que se cobró realmente — es lo que hace que un arqueo viejo
 * siga cuadrando.
 * ---------------------------------------------------------------------------
 */
@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
    private readonly stock: StockService,
    private readonly docNumber: DocumentNumberService,
  ) {}

  async createSale(
    dto: CreateSaleDto,
    clubId: string,
    userId: string,
    membershipId?: string | null,
  ) {
    if (dto.items.length === 0) {
      throw new BadRequestException('La venta no tiene productos.');
    }

    // Se traen todos los productos de una y se validan antes de abrir la
    // transacción: fallar temprano evita dejar la transacción abierta
    // mientras se resuelven errores de datos.
    const productIds = [...new Set(dto.items.map((i: { productId: string }) => i.productId))];
    const products = await this.prisma.db.product.findMany({
      where: { id: { in: productIds }, deletedAt: null, isActive: true },
      select: {
        id: true, name: true, salePrice: true, taxRate: true,
        trackStock: true, stockQty: true, kind: true, unit: true,
      },
    });

    const byId = new Map(
      (products as Array<{ id: string }>).map((p) => [p.id, p] as const),
    ) as Map<string, {
      id: string; name: string; salePrice: unknown; taxRate: unknown;
      trackStock: boolean; stockQty: unknown; kind: string; unit: string;
    }>;

    const missing = productIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(
        `Hay ${missing.length} producto(s) que no existen o están inactivos.`,
      );
    }

    // Aviso de stock insuficiente, sin bloquear: frenar un cobro porque el
    // inventario está desactualizado es peor negocio que el descuadre.
    const warnings: string[] = [];
    for (const item of dto.items) {
      const p = byId.get(item.productId);
      if (p && p.trackStock && this.num(p.stockQty) < item.quantity) {
        warnings.push(
          `${p.name}: quedan ${this.num(p.stockQty)} ${p.unit} y se venden ${item.quantity}.`,
        );
      }
    }

    return this.prisma.tenantTransaction(async (tx) => {
      const { code } = await this.docNumber.next(tx, clubId, 'SALE');

      let subtotal = 0;
      let taxAmount = 0;
      const lines = dto.items.map((item: {
        productId: string; quantity: number;
        unitPrice?: number; discountAmount?: number;
      }) => {
        const p = byId.get(item.productId);
        if (!p) throw new NotFoundException('Producto no encontrado en la venta.');
        // El precio puede venir sobreescrito (promoción puntual); si no,
        // se toma el de lista.
        const unitPrice = item.unitPrice ?? this.num(p.salePrice);
        const gross = this.round(unitPrice * item.quantity);
        const discount = this.round(item.discountAmount ?? 0);
        const total = this.round(gross - discount);
        const rate = this.num(p.taxRate);
        // El precio de lista es final (IVA incluido), así que el impuesto se
        // extrae del total, no se suma encima.
        const tax = this.round(total - total / (1 + rate / 100));

        subtotal += gross;
        taxAmount += tax;

        return {
          productId: p.id,
          description: p.name,
          quantity: item.quantity,
          unitPrice,
          discountAmount: discount,
          taxRate: rate,
          total,
          trackStock: p.trackStock,
          kind: p.kind,
        };
      });

      const discountAmount = this.round(
        lines.reduce((acc: number, l: { discountAmount: number }) => acc + l.discountAmount, 0) + (dto.globalDiscount ?? 0),
      );
      const total = this.round(subtotal - discountAmount);

      if (total < 0) {
        throw new BadRequestException('El descuento supera el total de la venta.');
      }

      const sale = await tx.sale.create({
        data: {
          clubId,
          code,
          clientId: dto.clientId ?? null,
          subtotal: this.round(subtotal),
          discountAmount,
          taxAmount: this.round(taxAmount),
          total,
          paidAmount: 0,
          status: 'COMPLETED',
          soldById: userId,
        },
        select: { id: true, code: true },
      });

      await tx.saleItem.createMany({
        data: lines.map((l: typeof lines[number]) => ({
          clubId,
          saleId: sale.id,
          productId: l.productId,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountAmount: l.discountAmount,
          taxRate: l.taxRate,
          total: l.total,
        })),
      });

      // Baja de inventario, una por línea.
      for (const l of lines) {
        if (!l.trackStock || l.kind === 'SERVICE') continue;
        await this.stock.registerMovement(tx, {
          clubId,
          productId: l.productId,
          type: 'SALE',
          quantity: l.quantity,
          reference: sale.code,
          createdById: userId,
        });
      }

      // --- cobro ---
      let paidAmount = 0;

      if (dto.toAccount) {
        if (!dto.clientId) {
          throw new BadRequestException(
            'Para cargar a cuenta corriente hace falta identificar al cliente.',
          );
        }
        await this.payments.chargeToAccount(tx, {
          clubId,
          clientId: dto.clientId,
          amount: total,
          concept: `Buffet ${sale.code}`,
          saleId: sale.id,
          createdById: userId,
        });
      } else if (dto.bookingId) {
        // Consumo cargado a un turno abierto: el cliente paga todo junto al
        // final. Es el flujo real del club — juegan, toman algo, pagan.
        const booking = await tx.booking.findFirst({
          where: { id: dto.bookingId, deletedAt: null },
          select: { id: true, code: true, status: true, totalPrice: true, clientId: true },
        });
        if (!booking) throw new NotFoundException('El turno no existe.');
        if (['COMPLETED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_CLUB', 'NO_SHOW']
            .includes(booking.status)) {
          throw new ConflictException(
            'Ese turno ya está cerrado. Cobrá el consumo aparte.',
          );
        }
        await tx.booking.update({
          where: { id: booking.id },
          data: { totalPrice: { increment: total } },
        });
        await tx.sale.update({
          where: { id: sale.id },
          data: { status: 'COMPLETED' },
        });
      } else if (dto.payment) {
        if (dto.payment.amount > total) {
          throw new BadRequestException('El pago supera el total de la venta.');
        }
        await this.payments.register(tx, {
          clubId,
          clientId: dto.clientId ?? null,
          saleId: sale.id,
          paymentMethodId: dto.payment.paymentMethodId,
          amount: dto.payment.amount,
          concept: `Buffet ${sale.code}`,
          cashSessionId: dto.payment.cashSessionId ?? null,
          membershipId,
          receivedById: userId,
        });
        paidAmount = dto.payment.amount;
      } else {
        throw new BadRequestException(
          'Indicá cómo se cobra: efectivo, cuenta corriente o a un turno.',
        );
      }

      await tx.sale.update({
        where: { id: sale.id },
        data: { paidAmount },
      });

      // El buffet actualiza el gasto del cliente igual que una reserva: es
      // consumo del club, y contarlo aparte distorsiona el ticket promedio.
      if (dto.clientId) {
        await tx.client.update({
          where: { id: dto.clientId },
          data: { totalSpent: { increment: total }, lastVisitAt: new Date() },
        });
      }

      return {
        id: sale.id,
        code: sale.code,
        subtotal: this.round(subtotal),
        discountAmount,
        taxAmount: this.round(taxAmount),
        total,
        paidAmount,
        change: dto.payment?.tendered
          ? this.round(dto.payment.tendered - paidAmount)
          : 0,
        warnings,
      };
    });
  }

  /**
   * Anula una venta.
   *
   * Devuelve el stock y revierte el cobro. No borra nada: el libro de caja es
   * append-only y una venta que desaparece deja un arqueo que no cuadra sin
   * explicación posible.
   */
  async voidSale(saleId: string, reason: string, clubId: string, userId: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('Indicá el motivo de la anulación.');
    }

    return this.prisma.tenantTransaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: saleId },
        select: {
          id: true, code: true, status: true, total: true, clientId: true,
          items: {
            select: { productId: true, quantity: true, description: true },
          },
          payments: {
            where: { status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] } },
            select: { id: true, amount: true, refundedAmount: true },
          },
        },
      });

      if (!sale) throw new NotFoundException('Venta no encontrada');
      if (sale.status === 'VOIDED') {
        throw new ConflictException('La venta ya está anulada.');
      }

      // Devolver el stock.
      for (const item of sale.items) {
        if (!item.productId) continue;
        await this.stock.registerMovement(tx, {
          clubId,
          productId: item.productId,
          type: 'RETURN',
          quantity: this.num(item.quantity),
          reference: sale.code,
          reason: `Anulación: ${reason}`,
          createdById: userId,
        });
      }

      // Revertir los cobros.
      let refunded = 0;
      for (const p of sale.payments) {
        const available = this.num(p.amount) - this.num(p.refundedAmount);
        if (available <= 0) continue;
        await this.payments.refund(tx, {
          clubId,
          paymentId: p.id,
          amount: available,
          reason: `Anulación de venta ${sale.code}: ${reason}`,
          createdById: userId,
        });
        refunded += available;
      }

      await tx.sale.update({
        where: { id: sale.id },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason },
      });

      if (sale.clientId) {
        await tx.client.update({
          where: { id: sale.clientId },
          data: { totalSpent: { decrement: this.num(sale.total) } },
        });
      }

      await tx.auditLog.create({
        data: {
          clubId, userId, action: 'VOID',
          entityType: 'Sale', entityId: sale.id, reason,
          changes: { code: sale.code, refunded: this.round(refunded) } as never,
        },
      });

      return { code: sale.code, refunded: this.round(refunded) };
    });
  }

  /** Catálogo para la pantalla del POS: lo que se puede vender ahora. */
  async getCatalog(categoryId?: string) {
    const products = await this.prisma.db.product.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(categoryId ? { categoryId } : {}),
      },
      select: {
        id: true, name: true, sku: true, barcode: true,
        salePrice: true, stockQty: true, trackStock: true,
        unit: true, kind: true, imageUrl: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
    });

    return products.map((p: Record<string, unknown>) => ({
      ...p,
      salePrice: this.num(p.salePrice),
      stockQty: this.num(p.stockQty),
      // La pantalla lo usa para marcar en rojo sin recalcular.
      available: !p.trackStock || this.num(p.stockQty) > 0,
    }));
  }

  /** Ventas de un turno de caja. Alimenta el detalle del cierre. */
  async getSalesBySession(cashSessionId: string) {
    return this.prisma.db.sale.findMany({
      where: { cashSessionId },
      select: {
        id: true, code: true, total: true, status: true, createdAt: true,
        client: { select: { firstName: true, lastName: true } },
        items: { select: { description: true, quantity: true, total: true } },
      },
      orderBy: { createdAt: 'desc' },
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
