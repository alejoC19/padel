import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Health checks para el orquestador del hosting. PrismaModule es global,
 * así que PrismaService se inyecta sin importarlo acá.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
