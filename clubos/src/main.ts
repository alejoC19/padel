import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { StructuredLogger } from './common/logging/structured-logger';
import { initErrorReporter } from './common/observability/error-reporter';

async function bootstrap(): Promise<void> {
  // Error tracking (Sentry si está configurado) antes que nada, para capturar
  // fallos incluso durante el arranque.
  initErrorReporter();

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    logger: new StructuredLogger(),
    // El cuerpo crudo se necesita para validar firmas de webhooks
    // (Mercado Pago). Sin esto la verificación HMAC falla.
    rawBody: true,
  });

  app.use(helmet());
  app.use(cookieParser());

  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'metrics'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
    credentials: true,
    // x-club-id permite cambiar de club sin re-login.
    allowedHeaders: ['Content-Type', 'Authorization', 'x-club-id', 'x-request-id'],
  });

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  new StructuredLogger('Bootstrap').log(`ClubOS API escuchando en :${port}`);
}

void bootstrap();
