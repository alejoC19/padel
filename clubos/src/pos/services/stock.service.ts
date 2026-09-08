import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Control de stock.
 *
 * ---------------------------------------------------------------------------
 * EL KARDEX ES LA VERDAD, `stockQty` ES UN CACHE
 * ---------------------------------------------------------------------------
 * Nunca se escribe `Product.stockQty` a mano. Cada cambio inserta un
 * `StockMovement` y actualiza el cache en la misma transacción. La razón es
 * que un inventario sin rastro es imposible de auditar: cuando falten seis
 * Cocas nadie va a saber si se vendieron, se rompieron o se las tomó alguien.
 *
 * `balanceAfter` se guarda en cada movimiento para poder imprimir un kardex
 * sin recalcular toda la historia del producto.
 *
 * ---------------------------------------------------------------------------
 * SIGNO DE `quantity`
 * ---------------------------------------------------------------------------
 * Positivo entra, negativo sale. El tipo de movimiento determina el signo y
 * el servicio lo fuerza — si el operador pudiera elegirlo, una salida cargada
 * como entrada infla el inventario sin que nada lo detecte hasta el conteo
 * físico.
 * ---------------------------------------------------------------------------
 */

/**
 * Dirección de cada tipo de movimiento.
 *   1 = entra, -1 = sale, 0 = el signo lo trae la cantidad (ajustes).
 */
const DIRECTION: Record<string, 1 | 0 | -1> = {
  PURCHASE: 1,     // compra a proveedor
  RETURN: 1,       // devolución de un cliente
  INITIAL: 1,      // carga inicial de inventario
  SALE: -1,        // venta en el buffet
  LOSS: -1,        // rotura, vencimiento, robo
  TRANSFER: -1,    // envío a otra sede
  ADJUSTMENT: 0,   // ajuste por conteo: el signo lo da la diferencia
};

export interface StockAlert {
  productId: string;
  name: string;
  stockQty: number;
  minStockQty: number;
  unit: string;
  /** Cuánto falta para llegar al mínimo. */
  shortfall: number;
  severity: 'OUT_OF_STOCK' | 'BELOW_MINIMUM' | 'NEGATIVE';
}

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra un movimiento de stock.
   *
   * SIEMPRE se llama dentro de una transacción existente. El movimiento y lo
   * que lo origina (una venta, una compra) tienen que confirmarse juntos: un
   * descuento de stock sin venta deja el inventario mintiendo hacia abajo, y
   * una venta sin descuento lo deja mintiendo hacia arriba.
   */
  async registerMovement(
    tx: Prisma.TransactionClient,
    input: {
      clubId: string;
      productId: string;
      type: string;
      /** Siempre positivo salvo en ADJUSTMENT, donde puede ser negativo. */
      quantity: number;
      unitCost?: number;
      reference?: string;
      reason?: string;
      createdById?: string | null;
    },
  ): Promise<{ balanceAfter: number; wentNegative: boolean }> {
    const direction = DIRECTION[input.type];
    if (direction === undefined) {
      throw new BadRequestException(`Tipo de movimiento desconocido: ${input.type}`);
    }

    const product = await tx.product.findFirst({
      where: { id: input.productId, deletedAt: null },
      select: { id: true, name: true, trackStock: true, kind: true, stockQty: true },
    });

    if (!product) throw new NotFoundException('Producto no encontrado');

    // Los servicios (alquiler de paleta, clase suelta) no tienen existencias.
    if (!product.trackStock || product.kind === 'SERVICE') {
      return { balanceAfter: 0, wentNegative: false };
    }

    // ADJUSTMENT lleva el signo que le pasan; el resto lo determina el tipo.
    const signed =
      direction === 0 ? input.quantity : Math.abs(input.quantity) * direction;

    if (signed === 0) {
      throw new BadRequestException('El movimiento no puede ser de cantidad cero.');
    }

    // El increment toma lock de la fila, así que dos ventas simultáneas del
    // mismo producto se serializan y ninguna lee un stock desactualizado.
    const updated = await tx.product.update({
      where: { id: input.productId },
      data: { stockQty: { increment: signed } },
      select: { stockQty: true },
    });

    const balanceAfter = this.num(updated.stockQty);

    await tx.stockMovement.create({
      data: {
        clubId: input.clubId,
        productId: input.productId,
        type: input.type as never,
        quantity: signed,
        unitCost: input.unitCost ?? 0,
        balanceAfter,
        reference: input.reference,
        reason: input.reason,
        createdById: input.createdById ?? null,
      },
    });

    return {
      balanceAfter,
      // No se bloquea la venta: frenar un cobro de $2.000 porque el
      // inventario está desactualizado es peor negocio que el descuadre. El
      // stock negativo queda visible como alerta, que es la señal de que hay
      // que hacer un conteo.
      wentNegative: balanceAfter < 0,
    };
  }

  /**
   * Compra a proveedor: entrada de mercadería.
   *
   * Actualiza el costo del producto con el de esta compra. Se usa el último
   * costo y no un promedio ponderado porque en un buffet de club los precios
   * suben seguido y el promedio subestima la reposición — que es la decisión
   * que el dueño realmente toma con este número.
   */
  async receivePurchase(
    input: {
      clubId: string;
      supplierId?: string | null;
      items: Array<{ productId: string; quantity: number; unitCost: number }>;
      documentNumber?: string;
      notes?: string;
      createdById?: string | null;
    },
  ): Promise<{ received: number; totalCost: number }> {
    if (input.items.length === 0) {
      throw new BadRequestException('La compra no tiene items.');
    }

    return this.prisma.tenantTransaction(async (tx) => {
      let totalCost = 0;

      for (const item of input.items) {
        if (item.quantity <= 0) {
          throw new BadRequestException('Las cantidades deben ser mayores a cero.');
        }

        await this.registerMovement(tx, {
          clubId: input.clubId,
          productId: item.productId,
          type: 'PURCHASE',
          quantity: item.quantity,
          unitCost: item.unitCost,
          reference: input.documentNumber,
          reason: input.notes,
          createdById: input.createdById,
        });

        await tx.product.update({
          where: { id: item.productId },
          data: { costPrice: item.unitCost },
        });

        totalCost += item.quantity * item.unitCost;
      }

      await tx.auditLog.create({
        data: {
          clubId: input.clubId,
          userId: input.createdById ?? undefined,
          action: 'CREATE',
          entityType: 'StockPurchase',
          changes: {
            items: input.items.length,
            totalCost: this.round(totalCost),
            supplierId: input.supplierId,
            document: input.documentNumber,
          } as never,
        },
      });

      return { received: input.items.length, totalCost: this.round(totalCost) };
    });
  }

  /**
   * Ajuste por conteo físico.
   *
   * Recibe la cantidad CONTADA, no la diferencia: el operador cuenta botellas,
   * no calcula deltas. El sistema deriva el ajuste, que es donde estaría el
   * error si lo hiciera una persona con la planilla en la mano.
   */
  async adjustToCount(
    input: {
      clubId: string;
      productId: string;
      countedQty: number;
      reason: string;
      createdById?: string | null;
    },
  ): Promise<{ previous: number; counted: number; difference: number }> {
    if (!input.reason?.trim()) {
      throw new BadRequestException(
        'Un ajuste de inventario necesita un motivo. Sin eso no se puede auditar.',
      );
    }

    return this.prisma.tenantTransaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: input.productId, deletedAt: null },
        select: { stockQty: true, name: true, trackStock: true },
      });

      if (!product) throw new NotFoundException('Producto no encontrado');
      if (!product.trackStock) {
        throw new ConflictException('Este producto no lleva control de stock.');
      }

      const previous = this.num(product.stockQty);
      const difference = this.round(input.countedQty - previous);

      if (difference === 0) {
        return { previous, counted: input.countedQty, difference: 0 };
      }

      await this.registerMovement(tx, {
        clubId: input.clubId,
        productId: input.productId,
        type: 'ADJUSTMENT',
        quantity: difference,
        reason: input.reason,
        createdById: input.createdById,
      });

      await tx.auditLog.create({
        data: {
          clubId: input.clubId,
          userId: input.createdById ?? undefined,
          action: 'UPDATE',
          entityType: 'Product',
          entityId: input.productId,
          reason: input.reason,
          changes: { previous, counted: input.countedQty, difference } as never,
        },
      });

      return { previous, counted: input.countedQty, difference };
    });
  }

  /** Baja por rotura, vencimiento o pérdida. */
  async registerLoss(
    input: {
      clubId: string;
      productId: string;
      quantity: number;
      reason: string;
      createdById?: string | null;
    },
  ): Promise<{ balanceAfter: number }> {
    if (!input.reason?.trim()) {
      throw new BadRequestException('Indicá el motivo de la baja.');
    }
    return this.prisma.tenantTransaction(async (tx) => {
      const res = await this.registerMovement(tx, {
        clubId: input.clubId,
        productId: input.productId,
        type: 'LOSS',
        quantity: input.quantity,
        reason: input.reason,
        createdById: input.createdById,
      });
      return { balanceAfter: res.balanceAfter };
    });
  }

  /**
   * Productos que hay que reponer.
   *
   * Es la pantalla que el dueño mira antes de llamar al proveedor, así que
   * ordena por urgencia: primero lo que está en negativo (hay un error de
   * inventario), después lo agotado, después lo que está bajo el mínimo.
   */
  async getAlerts(): Promise<StockAlert[]> {
    const products = await this.prisma.tenantQueryRaw<
      Array<Record<string, unknown>>
    >(`
      SELECT id, name, "stockQty", "minStockQty", unit
      FROM products
      WHERE "clubId" = current_club_id()
        AND "deletedAt" IS NULL
        AND "isActive" = true
        AND "trackStock" = true
        AND "stockQty" <= "minStockQty"
      ORDER BY ("stockQty" - "minStockQty") ASC
      LIMIT 100
    `);

    return products.map((p) => {
      const stockQty = this.num(p.stockQty);
      const minStockQty = this.num(p.minStockQty);
      return {
        productId: String(p.id),
        name: String(p.name),
        stockQty,
        minStockQty,
        unit: String(p.unit),
        shortfall: this.round(Math.max(0, minStockQty - stockQty)),
        severity:
          stockQty < 0 ? 'NEGATIVE'
          : stockQty === 0 ? 'OUT_OF_STOCK'
          : 'BELOW_MINIMUM',
      };
    });
  }

  /** Kardex de un producto: cada entrada y salida, con su saldo. */
  async getKardex(productId: string, limit = 100) {
    const [product, movements] = await Promise.all([
      this.prisma.db.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: {
          id: true, name: true, unit: true, stockQty: true,
          minStockQty: true, costPrice: true, salePrice: true,
        },
      }),
      this.prisma.db.stockMovement.findMany({
        where: { productId },
        select: {
          id: true, type: true, quantity: true, unitCost: true,
          balanceAfter: true, reason: true, reference: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 500),
      }),
    ]);

    if (!product) throw new NotFoundException('Producto no encontrado');

    return {
      product: {
        ...product,
        stockQty: this.num(product.stockQty),
        minStockQty: this.num(product.minStockQty),
        costPrice: this.num(product.costPrice),
        salePrice: this.num(product.salePrice),
        // El margen se calcula, no se guarda: si el costo cambia, un margen
        // almacenado queda viejo sin que nadie lo note.
        marginPercent: this.num(product.costPrice) > 0
          ? this.round(
              ((this.num(product.salePrice) - this.num(product.costPrice)) /
                this.num(product.costPrice)) * 100,
            )
          : null,
      },
      movements: movements.map((m: Record<string, unknown>) => ({
        ...m,
        quantity: this.num(m.quantity),
        unitCost: this.num(m.unitCost),
        balanceAfter: this.num(m.balanceAfter),
      })),
    };
  }

  /** Valuación del inventario: cuánta plata hay parada en el depósito. */
  async getInventoryValue() {
    const rows = await this.prisma.tenantQueryRaw<
      Array<Record<string, unknown>>
    >(`
      SELECT
        COUNT(*)::int AS products,
        COALESCE(SUM("stockQty" * "costPrice"), 0)::numeric AS cost_value,
        COALESCE(SUM("stockQty" * "salePrice"), 0)::numeric AS sale_value,
        COUNT(*) FILTER (WHERE "stockQty" <= 0)::int AS out_of_stock,
        COUNT(*) FILTER (WHERE "stockQty" > 0 AND "stockQty" <= "minStockQty")::int AS low_stock
      FROM products
      WHERE "clubId" = current_club_id()
        AND "deletedAt" IS NULL AND "isActive" = true AND "trackStock" = true
    `);

    const r = rows[0] ?? {};
    const costValue = this.num(r.cost_value);
    const saleValue = this.num(r.sale_value);

    return {
      products: Number(r.products ?? 0),
      costValue,
      saleValue,
      // Ganancia si se vendiera todo el inventario actual.
      potentialProfit: this.round(saleValue - costValue),
      outOfStock: Number(r.out_of_stock ?? 0),
      lowStock: Number(r.low_stock ?? 0),
    };
  }

  private num(v: unknown): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    return Number((v as { toString(): string }).toString());
  }

  private round(n: number): number {
    return Math.round(n * 1000) / 1000;
  }
}
