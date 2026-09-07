# Módulo `notifications` — WhatsApp + email

Avisos automáticos a los clientes del club: confirmación de reserva,
recordatorios (24h y 2h antes), cancelación y pago recibido. Reemplaza el
"grupo de WhatsApp a mano" que usan los clubes hoy.

## Cómo funciona (arquitectura)

**Se encola, no se envía en el request.** Emitir una notificación es un INSERT
en la tabla `Notification` con estado `PENDING`. Un worker interno (cron) vacía
esa cola. El request del usuario nunca espera a que WhatsApp responda.

```
Reserva pagada ──► NotificationsService.enqueue*() ──► filas PENDING
                                                            │
                        NotificationWorker (cada 1 min) ────┘
                                    │
                        ChannelDispatcher ──► WhatsappChannel / EmailChannel
```

**Por qué la cola vive en Postgres y no en BullMQ (todavía):** a volumen de
club de pádel (decenas/cientos de mensajes/día), la tabla como cola es más
simple de operar (no hay proceso worker aparte), sobrevive reinicios, y es
idempotente. La interfaz `enqueue*` no cambia si mañana se migra a BullMQ.

## Estructura

```
notifications/
├── notifications.module.ts
├── services/
│   ├── notifications.service.ts       enqueue* — lo llaman otros módulos
│   ├── notification.worker.ts         @Cron 1min: vacía la cola PENDING
│   ├── reminder.scheduler.ts          @Cron 10min: encola recordatorios 24h/2h
│   ├── channel-dispatcher.service.ts  rutea al canal correcto
│   ├── format.util.ts                 fecha/hora/plata en es-AR
│   └── channels/
│       ├── channel.interface.ts       contrato de un canal
│       ├── whatsapp.channel.ts        Meta Cloud API
│       └── email.channel.ts           Resend
└── templates/
    └── message-templates.ts           el copy de cada tipo de aviso
```

## Puntos de enganche (dónde se emiten)

- **Crear una reserva** (`BookingService.create`): encola `BOOKING_CONFIRMED`.
  Un solo punto de enganche cubre tanto el mostrador como el portal público
  (`PublicService.reservar` llama al mismo `create()`).
- **Cancelar una reserva** (`BookingService.cancel`): encola `BOOKING_CANCELLED`.
  Mismo criterio: cubre mostrador y cancelación del jugador desde el portal.
- **Pago online aprobado** (`payments-gateway`): al confirmarse el webhook de
  MP, se encola `PAYMENT_RECEIVED` (más un `BOOKING_CONFIRMED` adicional,
  histórico de cuando el pago online era el único disparador — quedó
  redundante con el punto de arriba pero inofensivo: dos avisos de
  "confirmada" en vez de uno si además pagó por MP).
- **Recordatorios**: el `ReminderScheduler` los encola solo, buscando reservas
  que arrancan en ~24h y ~2h. No requiere que nadie lo llame.

Los tres primeros encolan FUERA de la transacción que crea/cancela/cobra la
reserva (ya commiteó): si el enqueue falla, se loguea y no se revierte nada —
perder un aviso no debe perder una reserva ni un pago.

## Configuración

Ver `.env.example`. Sin credenciales, el canal correspondiente se marca "no
configurado" y esas filas terminan en FAILED (no rompe nada; el resto sigue).

### WhatsApp (Meta Cloud API)
```
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_TEMPLATE_LANG=es_AR
```
**Plantillas:** fuera de la ventana de 24h, WhatsApp exige plantillas aprobadas
por Meta. Los nombres en `message-templates.ts` (`booking_confirmed`,
`booking_reminder`, `booking_cancelled`, `payment_received`) deben existir y
estar aprobados en tu cuenta de Meta, con las variables en el mismo orden que
`waParams`. Si preferís no pelear con Meta al inicio, la interfaz `NotificationChannel`
la implementa igual un intermediario (360dialog, Wati, Gupshup): se cambia solo
`whatsapp.channel.ts`.

### Email (Resend)
```
RESEND_API_KEY=
EMAIL_FROM=ClubOS <hola@tudominio.com.ar>
```
El dominio del `From` debe estar verificado en Resend.

## Reintentos y estados

Cada fila `Notification` transita: `PENDING` → (worker la toma) → `SENT` si el
proveedor aceptó; si falló y es transitorio (timeout, 429, 5xx) vuelve a
`PENDING` con `retryCount++` hasta 4 intentos; si es permanente (número/plantilla
inválidos) va a `FAILED` con el motivo en `error`.

**Claim atómico:** el worker reclama el lote con `UPDATE ... FOR UPDATE SKIP
LOCKED`, así dos instancias de la API no mandan el mismo mensaje dos veces.
Trade-off documentado en el código: si el proceso muere entre el claim y el
envío, esa fila queda `SENT` sin mandarse (at-most-once). Aceptable a este
volumen; si se vuelve crítico, agregar un estado `SENDING` intermedio.

## Probar local

1. Configurá al menos un canal en `.env` (o ninguno, para ver el flujo de cola).
2. Levantá la API. Los cron arrancan solos (`ScheduleModule` está en AppModule).
3. Encolá algo: hacé un pago online que apruebe, o insertá una fila PENDING a
   mano y mirá cómo el worker la procesa en el próximo minuto.
4. Revisá la tabla `notifications`: estados, `providerMessageId`, `error`.

## Lo que queda

- **Push** (el canal está en el enum; falta implementar `push.channel.ts` con
  FCM/APNs cuando haya app).
- **Preferencias de notificación** por cliente (opt-out de recordatorios).
- **Tests:** unit de plantillas y del parseo de teléfono; e2e del worker
  (encolar → procesar → estado). Fase 4.

Cubierto por `test/integration/booking-notifications.int-spec.ts`: crear y
cancelar una reserva encolan `BOOKING_CONFIRMED`/`BOOKING_CANCELLED` de
verdad (prueba `BookingService` real, no una reimplementación).
