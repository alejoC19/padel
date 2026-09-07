import {
  Body, Controller, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { TreasuryService } from './services/treasury.service';
import { CashFlowService } from './services/cash-flow.service';
import { ExpenseService } from './services/expense.service';
import {
  CashFlowDto, CreateAccountDto, CreateExpenseDto, CreateSupplierDto,
  ImportStatementDto, PayExpenseDto, PeriodDto, ReconcileDto,
} from './dto/treasury.dto';
import { ClubId, RequirePermissions, UserId } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

@Controller('treasury')
export class TreasuryController {
  constructor(
    private readonly treasury: TreasuryService,
    private readonly cashFlow: CashFlowService,
    private readonly expenses: ExpenseService,
  ) {}

  // -------------------------------------------------------------------------
  // Cuentas bancarias
  // -------------------------------------------------------------------------

  @Get('accounts')
  @RequirePermissions(PERMISSIONS.TREASURY_VIEW)
  async accounts() {
    return this.treasury.listAccounts();
  }

  @Post('accounts')
  @RequirePermissions(PERMISSIONS.TREASURY_MANAGE)
  async createAccount(@Body() dto: CreateAccountDto, @ClubId() clubId: string) {
    return this.treasury.createAccount({ clubId, ...dto });
  }

  /**
   * Importa un extracto.
   *
   * Reimportar el mismo archivo es seguro: las filas ya cargadas se detectan
   * por huella y se reportan como duplicados, sin frenar el resto.
   */
  @Post('accounts/:id/import')
  @RequirePermissions(PERMISSIONS.BANK_RECONCILE)
  async importStatement(
    @Param('id', ParseUUIDPipe) accountId: string,
    @Body() dto: ImportStatementDto,
    @ClubId() clubId: string,
  ) {
    return this.treasury.importStatement(
      clubId, accountId, dto.rows, dto.source ?? 'IMPORT_CSV',
    );
  }

  // -------------------------------------------------------------------------
  // Conciliación
  // -------------------------------------------------------------------------

  /** Propone con qué cobro o gasto se corresponde cada movimiento. */
  @Get('accounts/:id/suggestions')
  @RequirePermissions(PERMISSIONS.BANK_RECONCILE)
  async suggestions(
    @Param('id', ParseUUIDPipe) accountId: string,
    @Query('limit') limit?: string,
  ) {
    return this.treasury.getSuggestions(accountId, limit ? Number(limit) : 25);
  }

  @Post('transactions/:id/reconcile')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.BANK_RECONCILE)
  async reconcile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReconcileDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.treasury.reconcile(id, dto, clubId, userId);
  }

  @Post('transactions/:id/unreconcile')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.BANK_RECONCILE)
  async unreconcile(
    @Param('id', ParseUUIDPipe) id: string,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.treasury.unreconcile(id, clubId, userId);
  }

  // -------------------------------------------------------------------------
  // Flujo de fondos
  // -------------------------------------------------------------------------

  /** "¿Me alcanza para pagar sueldos el viernes?" */
  @Get('cash-flow')
  @RequirePermissions(PERMISSIONS.TREASURY_VIEW)
  async projection(@Query() q: CashFlowDto) {
    return this.cashFlow.project(q.days ?? 30);
  }

  // -------------------------------------------------------------------------
  // Gastos
  // -------------------------------------------------------------------------

  @Get('expenses/pending')
  @RequirePermissions(PERMISSIONS.EXPENSE_VIEW)
  async pendingExpenses() {
    return this.expenses.listPending();
  }

  @Get('expenses/by-category')
  @RequirePermissions(PERMISSIONS.REPORT_FINANCIAL)
  async expensesByCategory(@Query() q: PeriodDto) {
    return this.expenses.getByCategory(q.from, q.to);
  }

  /** Registra la obligación. No mueve plata. */
  @Post('expenses')
  @RequirePermissions(PERMISSIONS.EXPENSE_CREATE)
  async createExpense(
    @Body() dto: CreateExpenseDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.expenses.registerExpense({ clubId, ...dto, createdById: userId });
  }

  /** Paga: acá sí sale la plata de la caja o del banco. */
  @Post('expenses/:id/pay')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EXPENSE_APPROVE)
  async payExpense(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayExpenseDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.expenses.payExpense(id, { clubId, ...dto, createdById: userId });
  }

  // -------------------------------------------------------------------------
  // Proveedores
  // -------------------------------------------------------------------------

  @Get('suppliers')
  @RequirePermissions(PERMISSIONS.EXPENSE_VIEW)
  async suppliers() {
    return this.expenses.listSuppliers();
  }

  @Post('suppliers')
  @RequirePermissions(PERMISSIONS.SUPPLIER_MANAGE)
  async createSupplier(@Body() dto: CreateSupplierDto, @ClubId() clubId: string) {
    return this.expenses.createSupplier({ clubId, ...dto });
  }
}
