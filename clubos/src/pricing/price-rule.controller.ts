import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { PriceRuleService } from './services/price-rule.service';
import { CreatePriceRuleDto, UpdatePriceRuleDto } from './dto/price-rule.dto';
import { ClubId, RequirePermissions, UserId } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

@Controller('price-rules')
export class PriceRuleController {
  constructor(private readonly rules: PriceRuleService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRICE_VIEW)
  list() {
    return this.rules.list();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PRICE_MANAGE)
  create(
    @Body() dto: CreatePriceRuleDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.rules.create(dto, clubId, userId);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PRICE_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePriceRuleDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.rules.update(id, dto, clubId, userId);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PRICE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ): Promise<void> {
    await this.rules.remove(id, clubId, userId);
  }
}
