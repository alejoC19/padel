import {
  Body, Controller, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { PosService } from './services/pos.service';
import { StockService } from './services/stock.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdjustStockDto, CreateProductDto, CreateSaleDto,
  ReceivePurchaseDto, RegisterLossDto, VoidSaleDto,
} from './dto/pos.dto';
import { ClubId, Ctx, RequirePermissions, UserId } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import type { TenantContext } from '../tenancy/tenant-context';

@Controller('pos')
export class PosController {
  constructor(
    private readonly pos: PosService,
    private readonly stock: StockService,
    private readonly prisma: PrismaService,
  ) {}

  // -------------------------------------------------------------------------
  // Venta
  // -------------------------------------------------------------------------

  /** Catálogo de la pantalla del POS. */
  @Get('catalog')
  @RequirePermissions(PERMISSIONS.PRODUCT_VIEW)
  async catalog(@Query('categoryId') categoryId?: string) {
    return this.pos.getCatalog(categoryId);
  }

  @Get('categories')
  @RequirePermissions(PERMISSIONS.PRODUCT_VIEW)
  async categories() {
    return this.prisma.db.productCategory.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  @Post('sales')
  @RequirePermissions(PERMISSIONS.SALE_CREATE)
  async createSale(
    @Body() dto: CreateSaleDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
    @Ctx() ctx: TenantContext,
  ) {
    return this.pos.createSale(dto, clubId, userId, ctx.membershipId);
  }

  @Post('sales/:id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SALE_VOID)
  async voidSale(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidSaleDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.pos.voidSale(id, dto.reason, clubId, userId);
  }

  @Get('sales/:id')
  @RequirePermissions(PERMISSIONS.PRODUCT_VIEW)
  async getSale(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.db.sale.findFirst({
      where: { id },
      select: {
        id: true, code: true, subtotal: true, discountAmount: true,
        taxAmount: true, total: true, paidAmount: true, status: true,
        createdAt: true, voidedAt: true, voidReason: true,
        client: { select: { id: true, firstName: true, lastName: true } },
        items: {
          select: {
            description: true, quantity: true, unitPrice: true,
            discountAmount: true, total: true,
          },
        },
        payments: {
          select: {
            code: true, amount: true, paidAt: true,
            method: { select: { name: true, kind: true } },
          },
        },
      },
    });
  }

  // -------------------------------------------------------------------------
  // Stock
  // -------------------------------------------------------------------------

  /** Productos a reponer. Es lo que el dueño mira antes de llamar al proveedor. */
  @Get('stock/alerts')
  @RequirePermissions(PERMISSIONS.PRODUCT_VIEW)
  async alerts() {
    return this.stock.getAlerts();
  }

  /** Cuánta plata hay parada en el depósito. */
  @Get('stock/value')
  @RequirePermissions(PERMISSIONS.REPORT_FINANCIAL)
  async inventoryValue() {
    return this.stock.getInventoryValue();
  }

  @Get('stock/:productId/kardex')
  @RequirePermissions(PERMISSIONS.PRODUCT_VIEW)
  async kardex(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('limit') limit?: string,
  ) {
    return this.stock.getKardex(productId, limit ? Number(limit) : 100);
  }

  /** Entrada de mercadería. */
  @Post('stock/purchase')
  @RequirePermissions(PERMISSIONS.STOCK_ADJUST)
  async receivePurchase(
    @Body() dto: ReceivePurchaseDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.stock.receivePurchase({
      clubId,
      supplierId: dto.supplierId ?? null,
      items: dto.items,
      documentNumber: dto.documentNumber,
      notes: dto.notes,
      createdById: userId,
    });
  }

  /** Ajuste por conteo físico. */
  @Post('stock/:productId/count')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.STOCK_ADJUST)
  async adjustToCount(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: AdjustStockDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.stock.adjustToCount({
      clubId, productId,
      countedQty: dto.countedQty,
      reason: dto.reason,
      createdById: userId,
    });
  }

  /** Baja por rotura, vencimiento o pérdida. */
  @Post('stock/:productId/loss')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.STOCK_ADJUST)
  async registerLoss(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: RegisterLossDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.stock.registerLoss({
      clubId, productId,
      quantity: dto.quantity,
      reason: dto.reason,
      createdById: userId,
    });
  }

  // -------------------------------------------------------------------------
  // Productos
  // -------------------------------------------------------------------------

  @Post('products')
  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  async createProduct(
    @Body() dto: CreateProductDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.prisma.tenantTransaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          clubId,
          name: dto.name,
          categoryId: dto.categoryId ?? null,
          sku: dto.sku ?? null,
          barcode: dto.barcode ?? null,
          salePrice: dto.salePrice,
          costPrice: dto.costPrice ?? 0,
          taxRate: dto.taxRate ?? 21,
          kind: (dto.kind ?? 'GOOD') as never,
          trackStock: dto.trackStock ?? true,
          minStockQty: dto.minStockQty ?? 0,
          unit: dto.unit ?? 'unidad',
          stockQty: 0,
        },
        select: { id: true, name: true },
      });

      // El stock inicial entra como movimiento, no como valor directo: así el
      // kardex arranca explicando de dónde salió la primera existencia.
      if (dto.initialStock && dto.initialStock > 0 && (dto.trackStock ?? true)) {
        await this.stock.registerMovement(tx, {
          clubId,
          productId: product.id,
          type: 'INITIAL',
          quantity: dto.initialStock,
          unitCost: dto.costPrice ?? 0,
          reason: 'Carga inicial de inventario',
          createdById: userId,
        });
      }

      return product;
    });
  }
}
