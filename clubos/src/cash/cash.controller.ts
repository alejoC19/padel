import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CashService } from './services/cash.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CashHistoryDto,
  CloseSessionDto,
  CountCashDto,
  ManualMovementDto,
  OpenSessionDto,
  ReverseMovementDto,
} from './dto/cash.dto';
import { ClubId, Ctx, RequirePermissions, UserId } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import type { TenantContext } from '../tenancy/tenant-context';

@Controller('cash')
export class CashController {
  constructor(
    private readonly cash: CashService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Medios de pago activos del club.
   *
   * Vive acá y no en un módulo propio porque su único consumidor real es el
   * cobro: la pantalla necesita saber con qué puede cobrar y cuál es el
   * efectivo. Un CRUD completo de medios de pago va en configuración,
   * cuando se construya esa sección.
   */
  @Get('payment-methods')
  @RequirePermissions(PERMISSIONS.PAYMENT_VIEW)
  async paymentMethods() {
    return this.prisma.db.paymentMethod.findMany({
      where: { isActive: true, deletedAt: null },
      select: {
        id: true, code: true, name: true, kind: true,
        feePercent: true, settlementDays: true, affectsCashCount: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** Puestos de caja del club. Se consulta al abrir turno. */
  @Get('registers')
  @RequirePermissions(PERMISSIONS.CASH_VIEW)
  async registers() {
    return this.prisma.db.cashRegister.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  @Post('sessions')
  @RequirePermissions(PERMISSIONS.CASH_OPEN)
  async open(
    @Body() dto: OpenSessionDto,
    @ClubId() clubId: string,
    @Ctx() ctx: TenantContext,
  ) {
    if (!ctx.membershipId) {
      throw new ForbiddenException(
        'Se requiere una membresía activa para abrir caja.',
      );
    }
    return this.cash.open(dto, clubId, ctx.membershipId);
  }

  /** Caja abierta del usuario actual. Lo que ve recepción al entrar. */
  @Get('sessions/mine')
  @RequirePermissions(PERMISSIONS.CASH_VIEW)
  async mine(@Ctx() ctx: TenantContext) {
    if (!ctx.membershipId) return null;
    return this.cash.getMyOpenSession(ctx.membershipId);
  }

  /** Todas las cajas abiertas del club. Panel del dueño. */
  @Get('sessions/open')
  @RequirePermissions(PERMISSIONS.CASH_VIEW_ALL_SESSIONS)
  async listOpen() {
    return this.cash.listOpen();
  }

  @Get('sessions/history')
  @RequirePermissions(PERMISSIONS.CASH_VIEW_ALL_SESSIONS)
  async history(@Query() q: CashHistoryDto) {
    return this.cash.history(q);
  }

  @Get('sessions/:id')
  @RequirePermissions(PERMISSIONS.CASH_VIEW)
  async balance(
    @Param('id', ParseUUIDPipe) id: string,
    @Ctx() ctx: TenantContext,
  ) {
    await this.assertCanAccess(id, ctx);
    return this.cash.getBalance(id);
  }

  @Get('sessions/:id/movements')
  @RequirePermissions(PERMISSIONS.CASH_VIEW)
  async movements(
    @Param('id', ParseUUIDPipe) id: string,
    @Ctx() ctx: TenantContext,
  ) {
    await this.assertCanAccess(id, ctx);
    return this.cash.listMovements(id);
  }

  @Post('sessions/:id/movements')
  @RequirePermissions(PERMISSIONS.CASH_MOVEMENT)
  async addMovement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManualMovementDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
    @Ctx() ctx: TenantContext,
  ) {
    await this.assertCanAccess(id, ctx);

    // Los retiros mueven plata fuera del club: permiso aparte del de
    // registrar un gasto corriente.
    if (
      dto.type === 'WITHDRAWAL' &&
      !ctx.permissions.has(PERMISSIONS.CASH_WITHDRAWAL)
    ) {
      throw new ForbiddenException('No tenés permiso para registrar retiros.');
    }

    if (
      dto.type === 'ADJUSTMENT' &&
      !ctx.permissions.has(PERMISSIONS.CASH_ADJUST)
    ) {
      throw new ForbiddenException('No tenés permiso para registrar ajustes.');
    }

    return this.cash.addMovement(id, dto, clubId, userId);
  }

  @Post('movements/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.CASH_ADJUST)
  async reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseMovementDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.cash.reverseMovement(id, dto.reason, clubId, userId);
  }

  /** Arqueo sin cerrar: verificar el conteo durante el turno. */
  @Post('sessions/:id/count')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.CASH_VIEW)
  async count(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CountCashDto,
    @Ctx() ctx: TenantContext,
  ) {
    await this.assertCanAccess(id, ctx);
    return this.cash.count(id, dto.countedCash, dto.denominations);
  }

  @Post('sessions/:id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.CASH_CLOSE)
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseSessionDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
    @Ctx() ctx: TenantContext,
  ) {
    await this.assertCanAccess(id, ctx);
    return this.cash.close(id, dto, clubId, userId);
  }

  /**
   * Un operador solo accede a SU caja.
   *
   * Sin esto, cualquiera con CASH_VIEW podría ver o cerrar la caja de un
   * compañero — y el arqueo dejaría de tener un responsable claro, que es
   * todo el punto de tener cajas por turno y por persona.
   *
   * CASH_VIEW_ALL_SESSIONS (dueño, administrador) levanta la restricción.
   */
  private async assertCanAccess(
    sessionId: string,
    ctx: TenantContext,
  ): Promise<void> {
    if (ctx.permissions.has(PERMISSIONS.CASH_VIEW_ALL_SESSIONS)) return;

    const session = await this.prisma.db.cashSession.findFirst({
      where: { id: sessionId },
      select: { membershipId: true },
    });

    if (!session) return; // el servicio devolverá 404 con mejor mensaje

    if (session.membershipId !== ctx.membershipId) {
      throw new ForbiddenException(
        'Solo podés operar sobre tu propia caja.',
      );
    }
  }
}
