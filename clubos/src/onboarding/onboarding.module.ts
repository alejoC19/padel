import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './services/onboarding.service';

/**
 * Alta self-service de clubes.
 *
 * Importa AuthModule para reutilizar AuthService.login() y devolver al dueño
 * una sesión iniciada tras crear el club (sin un login manual extra).
 */
@Module({
  imports: [AuthModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
