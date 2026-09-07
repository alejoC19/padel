# Módulo `payments-gateway` — Pagos online con Mercado Pago

Cobro de reservas online, modelo **marketplace**: cada club conecta su propia
cuenta de Mercado Pago y cobra a esa cuenta. La plataforma nunca toca la plata
de las reservas (solo guarda, cifrados, los tokens de cada club).

El pago online termina en el **mismo camino contable** que un cobro de
mostrador: reutiliza `PaymentService.register()` sin modificarlo.

---

## Qué incluye

```
payments-gateway/
├── services/
│   ├── crypto.service.ts          AES-256-GCM para cifrar tokens de MP
│   ├── mercadopago.client.ts      HTTP a MP: OAuth, preferencias, webhook
│   ├── integration.service.ts     conectar/desconectar cuenta, tokens
│   └── payment-order.service.ts   crear orden + procesar webhook (idempotente)
├── payments.controller.ts             endpoints del club (autenticados)
├── mercadopago-webhook.controller.ts  webhook + callback OAuth (públicos)
├── dto/payment-gateway.dto.ts
├── payments-gateway.module.ts
└── PRISMA_ADDITIONS.prisma        (referencia; ya aplicado al schema)
```

---

## Puesta en marcha (checklist)

### 1. Base de datos
Los modelos `ClubPaymentIntegration` y `PaymentOrder` **ya están** en
`prisma/schema.prisma`. Generá el client y migrá:
```bash
npx prisma generate
npx prisma migrate dev --name add_payment_gateway
```

### 2. Variables de entorno
Ver `.env.example`. Las nuevas:
- `MP_APP_ID`, `MP_APP_SECRET` — tu app de MP (marketplace).
- `PAYMENTS_ENC_KEY` — clave de cifrado (≥32 chars). **Backup obligatorio.**
- `API_PUBLIC_URL` — debe ser alcanzable desde internet (en dev: ngrok).

### 3. Configurar la app de MP
En el panel de MP (developers → tu app):
- **Redirect URI:** `{API_PUBLIC_URL}/payments/mercadopago/oauth/callback`
- **Webhook URL:** `{API_PUBLIC_URL}/payments/mercadopago/webhook`
- Copiar el secreto del webhook a `MP_WEBHOOK_SECRET`.

### 4. Método de pago del club  ⚠️ CRÍTICO
Cada club necesita un `PaymentMethod` con `kind = MERCADO_PAGO` y, muy
importante, **`affectsCashCount = false`**: la plata online NO entra al cajón,
así que no debe pedir caja abierta ni sumar al arqueo. Ejemplo de seed:

```ts
await prisma.db.paymentMethod.create({
  data: {
    clubId,
    code: 'MP',
    name: 'Mercado Pago',
    kind: 'MERCADO_PAGO',
    feePercent: 5.0,       // comisión aprox de MP; ajustar
    settlementDays: 1,     // acreditación (afecta flujo de fondos)
    affectsCashCount: false, // ← NO afecta el arqueo de caja
    isActive: true,
  },
});
```

---

## Flujo completo

### A. El club conecta su cuenta (una vez)
1. Frontend → `POST /payments/mercadopago/connect` → devuelve `authorizationUrl`.
2. `window.location = authorizationUrl` → el dueño autoriza en MP.
3. MP redirige a `/payments/mercadopago/oauth/callback?code&state`.
4. El backend canjea el code, guarda los tokens cifrados, y redirige a
   `{WEB_PUBLIC_URL}/configuracion/pagos?mp=conectado`.
5. Estado consultable en `GET /payments/mercadopago/status`.

### B. Un jugador paga una reserva
1. Frontend → `POST /payments/orders/booking` con `{ bookingId }`.
2. Backend crea la orden, la preferencia en MP, y devuelve `initPoint`.
3. Frontend redirige al jugador a `initPoint` (Checkout Pro).
4. El jugador paga en MP.

### C. Confirmación (webhook — automático)
1. MP llama `POST /payments/mercadopago/webhook?club={clubId}`.
2. Se **verifica la firma** (`x-signature`) contra el secreto del club.
3. Se consulta el pago real en MP (no se confía en el body).
4. Si está `approved`, dentro de **una transacción**:
   - `PaymentService.register()` crea el `Payment` (kind MERCADO_PAGO).
   - Se completan los datos de pasarela en el `Payment`.
   - Se recalcula `paidAmount`/`paymentStatus` de la reserva.
   - Si quedó `PAID` y estaba `PENDING`, la reserva pasa a `CONFIRMED`.
   - La orden se cierra con `paymentId`.
5. **Idempotente:** si el webhook llega dos veces, la segunda no duplica nada
   (`providerPaymentId` es único y se re-chequea dentro de la tx).

---

## Decisiones de diseño (por si las revisás)

- **Fuente de verdad = MP, no el webhook.** El body del webhook solo trae un id;
  siempre consultamos `GET /v1/payments/{id}` con el token del club para el
  estado y monto reales. Evita que un webhook falsificado marque pagos.
- **Responder 200 siempre.** Aunque falle el procesamiento interno, a MP se le
  responde 200 para que no reintente en loop. Los fallos quedan logueados para
  un cron de reconciliación (pendiente de la Fase siguiente).
- **Tokens cifrados con AES-256-GCM** (autenticado): si tocan la fila en la BD,
  el descifrado falla en vez de devolver basura.
- **Reutilización total del PaymentService.** El pago online no es un camino
  contable nuevo: es un método más. Por eso `affectsCashCount=false` es la
  única condición para que todo lo demás (cuenta corriente, estados, reembolsos)
  funcione sin tocar nada.

---

## Lo que FALTA (siguiente iteración, no incluido acá)

- **Cron de reconciliación:** repasar órdenes `PENDING`/`IN_PROCESS` viejas y
  consultar su estado en MP, por si se perdió un webhook. Y expirar órdenes
  vencidas.
- **Reembolso online:** el `mercadopago.client.ts` ya tiene `refund()`, pero
  falta el endpoint que lo llame y enganche con `PaymentService.refund()`.
- **Suscripción del club a la plataforma (cobro a TU cuenta):** esto es el otro
  flujo de dinero (Fase 1b del roadmap), con *preapproval* de MP. No está acá.
- **Tests:** unit del `crypto.service` y `mercadopago.client` (firma), e
  integración del webhook idempotente con una MP sandbox. Es la Fase 4 y tu
  terreno de QA.
- **Webhook signature en producción:** validar contra el secreto real que
  configura MP en el panel, no el generado en dev.
```
