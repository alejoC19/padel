import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CourtBlockService } from './services/court-block.service';
import { CreateCourtBlockDto } from './dto/court-block.dto';
import { ClubId, RequirePermissions, UserId } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

@Controller('court-blocks')
export class CourtBlockController {
  constructor(private readonly blocks: CourtBlockService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BOOKING_VIEW)
  list(@Query('courtId') courtId?: string) {
    return this.blocks.list(courtId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.COURT_BLOCK)
  create(
    @Body() dto: CreateCourtBlockDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.blocks.create(dto, clubId, userId);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.COURT_BLOCK)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.blocks.remove(id);
  }
}
