import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './services/audit.service';
import { ListAuditLogsDto } from './dto/audit.dto';
import { ClubId, RequirePermissions } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  async list(@Query() q: ListAuditLogsDto, @ClubId() clubId: string) {
    return this.audit.list(clubId, q);
  }
}
