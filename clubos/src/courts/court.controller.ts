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
import { CourtService } from './services/court.service';
import { CreateCourtDto, UpdateCourtDto } from './dto/court.dto';
import { ClubId, RequirePermissions } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

@Controller('courts')
export class CourtController {
  constructor(private readonly courts: CourtService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.COURT_VIEW)
  list() {
    return this.courts.list();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.COURT_MANAGE)
  create(@Body() dto: CreateCourtDto, @ClubId() clubId: string) {
    return this.courts.create(dto, clubId);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.COURT_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCourtDto) {
    return this.courts.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.COURT_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.courts.remove(id);
  }
}
