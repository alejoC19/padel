import { Controller, Get, Query } from '@nestjs/common';
import { DailyCloseService } from './services/daily-close.service';
import { ProfitabilityService } from './services/profitability.service';
import { DailyCloseDto, PeriodDto } from './dto/reports.dto';
import { ClubId, RequirePermissions } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly dailyClose: DailyCloseService,
    private readonly profitability: ProfitabilityService,
  ) {}

  /**
   * Cierre de día: la pantalla que el dueño mira a la mañana.
   *
   * Requiere permiso financiero: recepción opera el día pero no ve la
   * rentabilidad del club.
   */
  @Get('daily-close')
  @RequirePermissions(PERMISSIONS.REPORT_FINANCIAL)
  async getDailyClose(@Query() q: DailyCloseDto, @ClubId() clubId: string) {
    return this.dailyClose.getDailyClose(q.date, clubId);
  }

  /** Qué producto deja más plata, no cuál se vende más. */
  @Get('products')
  @RequirePermissions(PERMISSIONS.REPORT_FINANCIAL)
  async productProfitability(@Query() q: PeriodDto, @ClubId() clubId: string) {
    return this.profitability.getProductProfitability(q.from, q.to, clubId);
  }

  /** Facturación por hora ocupada, que es lo que compara canchas distintas. */
  @Get('courts')
  @RequirePermissions(PERMISSIONS.REPORT_FINANCIAL)
  async courtProfitability(@Query() q: PeriodDto, @ClubId() clubId: string) {
    return this.profitability.getCourtProfitability(q.from, q.to, clubId);
  }

  /** Ocupación por día y hora: dónde están los huecos. */
  @Get('occupancy')
  @RequirePermissions(PERMISSIONS.REPORT_OPERATIONAL)
  async occupancy(@Query() q: PeriodDto, @ClubId() clubId: string) {
    return this.profitability.getOccupancyHeatmap(q.from, q.to, clubId);
  }
}
