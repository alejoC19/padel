import 'reflect-metadata';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
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

  // Un string suelto en `exclude` solo saca la ruta EXACTA del prefijo — no
  // sus subrutas. Sin el patrón '(.*)', /health/ready terminaba viviendo en
  // /api/v1/health/ready, al revés de lo que dice cada comentario del
  // healthcheck (y de lo que Railway/cualquier monitor espera encontrar).
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.ALL },
      { path: 'health/(.*)', method: RequestMethod.ALL },
      { path: 'metrics', method: RequestMethod.ALL },
    ],
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
