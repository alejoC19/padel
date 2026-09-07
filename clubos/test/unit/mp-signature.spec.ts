/**
 * Tests de la verificación de firma del webhook de Mercado Pago.
 *
 * Seguridad crítica: si esta verificación se rompe hacia "siempre acepta",
 * cualquiera podría enviar un webhook falso y marcar pagos como aprobados sin
 * pagar. El test construye una firma válida con el mismo algoritmo (HMAC-SHA256
 * sobre el manifest) y verifica que se acepte, y que cualquier alteración se
 * rechace.
 */
import { createHmac } from 'node:crypto';
import { MercadoPagoClient } from '../../src/payments-gateway/services/mercadopago.client';
import type { ConfigService } from '@nestjs/config';

function makeClient() {
  const config = { get: () => 'dummy' };
  return new MercadoPagoClient(config as unknown as ConfigService);
}

/** Arma un x-signature válido para un dataId/requestId/secret dados. */
function signValid(dataId: string, requestId: string, secret: string, ts = '1700000000') {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

describe('MercadoPagoClient.verifyWebhookSignature', () => {
  const secret = 'webhook-secret-del-club';
  const dataId = '123456789';
  const requestId = 'req-abc-123';

  it('acepta una firma válida', () => {
    const mp = makeClient();
    const xSignature = signValid(dataId, requestId, secret);
    expect(
      mp.verifyWebhookSignature({ xSignature, xRequestId: requestId, dataId, secret }),
    ).toBe(true);
  });

  it('rechaza si el secreto no coincide', () => {
    const mp = makeClient();
    const xSignature = signValid(dataId, requestId, 'otro-secreto');
    expect(
      mp.verifyWebhookSignature({ xSignature, xRequestId: requestId, dataId, secret }),
    ).toBe(false);
  });

  it('rechaza si el dataId fue alterado', () => {
    const mp = makeClient();
    const xSignature = signValid(dataId, requestId, secret);
    expect(
      mp.verifyWebhookSignature({
        xSignature,
        xRequestId: requestId,
        dataId: '999999999', // distinto del firmado
        secret,
      }),
    ).toBe(false);
  });

  it('rechaza una firma malformada', () => {
    const mp = makeClient();
    expect(
      mp.verifyWebhookSignature({
        xSignature: 'basura-sin-formato',
        xRequestId: requestId,
        dataId,
        secret,
      }),
    ).toBe(false);
  });

  it('rechaza si falta el header de firma', () => {
    const mp = makeClient();
    expect(
      mp.verifyWebhookSignature({ xSignature: '', xRequestId: requestId, dataId, secret }),
    ).toBe(false);
  });
});
