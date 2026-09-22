import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';

/**
 * Reporte de errores a Sentry.
 *
 * Desacoplado a propósito: el código de la app llama `reportError()` sin saber
 * si Sentry está activo. Si SENTRY_DSN no está seteada, es un no-op silencioso
 * (solo logs) — así el proyecto arranca sin cuenta de Sentry configurada.
 */

const log = new Logger('ErrorReporter');
let initialized = false;
let enabled = false;

export interface ErrorContext {
  method?: string;
  url?: string;
  status?: number;
  requestId?: string;
  clubId?: string;
  userId?: string;
}

export function initErrorReporter(): void {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    log.log('Sentry no configurado (SENTRY_DSN ausente): errores solo a logs.');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
    release: process.env.APP_VERSION,
  });
  enabled = true;
  log.log('Sentry inicializado.');
}

export function reportError(error: Error, context?: ErrorContext): void {
  if (!enabled) return; // no-op sin Sentry

  Sentry.withScope((scope) => {
    if (context?.clubId) scope.setTag('clubId', context.clubId);
    if (context?.requestId) scope.setTag('requestId', context.requestId);
    if (context?.userId) scope.setUser({ id: context.userId });
    if (context) scope.setContext('request', { ...context });
    Sentry.captureException(error);
  });
}
