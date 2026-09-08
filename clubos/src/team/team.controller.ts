import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { TeamService } from './services/team.service';
import { InviteStaffDto, UpdateMembershipDto } from './dto/team.dto';
import { ClubId, Ctx, RequirePermissions } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import type { TenantContext } from '../tenancy/tenant-context';

/** Alta y administración de staff del club — ver services/team.service.ts. */
@Controller('team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USER_VIEW)
  async list(@ClubId() clubId: string) {
    return this.team.list(clubId);
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.USER_VIEW)
  async listRoles(@ClubId() clubId: string) {
    return this.team.listRoles(clubId);
  }

  @Post('invite')
  @RequirePermissions(PERMISSIONS.USER_INVITE)
  async invite(@Ctx() ctx: TenantContext, @Body() dto: InviteStaffDto) {
    return this.team.invite(ctx, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  async update(
    @Ctx() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMembershipDto,
  ) {
    return this.team.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.team.remove(ctx, id);
  }
}
