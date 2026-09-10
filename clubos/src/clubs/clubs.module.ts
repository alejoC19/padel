import { Module } from '@nestjs/common';
import { ClubsController } from './clubs.controller';

@Module({
  controllers: [ClubsController],
})
export class ClubsModule {}
