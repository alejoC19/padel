import { Logger } from '@nestjs/common';

/**
 * Reporte de errores a un servicio externo (Sentry, u otro).
 *
 * Desacoplado a propósito: el código de la app llama `reportError()` sin saber
 * si hay Sentry detrás. Si SENTRY_DSN no está, es un no-op silencioso — así el
 * proyecto arranca sin cuenta de Sentry, y se activa solo con configurarlo.
 *
 * PARA ACTIVAR SENTRY:
 *   1. npm i @sentry/node
 *   2. setear SENTRY_DSN en el entorno
 *   3. descomentar el bloque marcado abajo
 *
 * Se deja como hook y no cableado directo para no imponer la dependencia (ni su
 * peso, ni su cuenta) a quien no la quiera todavía.
 */

const log = new Logger('ErrorReporter');
let initialized = false;
// Tipado laxo a propósito: @sentry/node es una dependencia OPCIONAL. Si se
// tipara con `typeof import('@sentry/node')`, el proyecto no compilaría sin
// tenerla instalada. Al activar Sentry, se puede ajustar este tipo.
let sentry: {
  withScope: (fn: (scope: SentryScope) => void) => void;
  captureException: (e: unknown) => void;
} | null = null;

interface SentryScope {
  setTag: (k: string, v: string) => void;
  setUser: (u: { id: string }) => void;
  setContext: (k: string, v: Record<string, unknown>) => void;
}

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

  // --- DESCOMENTAR tras instalar @sentry/node ---
  // sentry = require('@sentry/node');
  // sentry!.init({
  //   dsn,
  //   environment: process.env.NODE_ENV ?? 'development',
  //   tracesSampleRate: 0.1,
  //   release: process.env.APP_VERSION,
  // });
  // log.log('Sentry inicializado.');
  // ---------------------------------------------

  if (!sentry) {
    log.warn(
      'SENTRY_DSN presente pero el SDK no está instalado. ' +
        'Instalá @sentry/node y descomentá el init en error-reporter.ts.',
    );
  }
}

export function reportError(error: Error, context?: ErrorContext): void {
  if (!sentry) return; // no-op sin Sentry

  sentry.withScope((scope) => {
    if (context?.clubId) scope.setTag('clubId', context.clubId);
    if (context?.requestId) scope.setTag('requestId', context.requestId);
    if (context?.userId) scope.setUser({ id: context.userId });
    if (context) scope.setContext('request', { ...context });
    sentry!.captureException(error);
  });
}
