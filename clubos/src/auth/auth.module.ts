import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [JwtModule.register({}), NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
