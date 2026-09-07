# ClubOS — Roadmap técnico a MVP vendible

> Objetivo: pasar de "esqueleto sólido" a "primer club pagando".
> No es un roadmap del PRD completo. Es el camino más corto a que un dueño
> de club abra la app, cargue sus canchas, reciba reservas con pago online,
> y le llegue el recordatorio por WhatsApp a su cliente. Todo lo demás es fase 2.

---

## Dónde estás parado (línea de base real)

Lo que **ya existe y está bien** (no hay que rehacerlo):

- Multi-tenancy real: `clubId` en todo, RLS a nivel Postgres, `slug` para subdominio.
- Modelado SaaS completo: `Plan` (con `maxCourts`, `maxUsers`, `maxClients`,
  `features` como feature-flags JSON), `Club` con `status TRIAL`, `trialEndsAt`, `planId`.
- Núcleo contable serio: `payment.service` distingue métodos que afectan caja,
  calcula fees, valida sesión de caja, maneja cuenta corriente. Decimales, no floats.
- Auth con JWT + refresh + `switch-club` + `logout-all`. Guards de tenant y permisos.
- Enum `PaymentMethodKind` ya contempla `MERCADO_PAGO`, `QR`, etc. (los campos existen,
  falta la integración que los llene de verdad).
- Módulos NestJS limpios: bookings, cash, clients, pos, reports, tournaments, treasury.

Lo que **falta** para vender (los cuatro bloqueantes):

1. No cobra plata de verdad (sin gateway de pago).
2. No notifica nada (sin WhatsApp/email/push).
3. El onboarding no arma el tenant (register crea usuario suelto, no club+plan+owner).
4. No hay tests reales ni deploy productivo.

---

## Fase 0 — Que compile y corra de verdad (1 semana)

Antes de agregar features, cerrar que el proyecto arranca end-to-end. Es aburrido
pero si no, todo lo demás se construye sobre arena.

- [ ] `npm install` limpio en `clubos/` y `clubos-next/`. Resolver versiones.
- [ ] `docker compose up` levanta Postgres + Redis. Confirmar healthchecks.
- [ ] `prisma migrate deploy` + `db:manual` (RLS) + `db:seed` corren sin error.
- [ ] `npm run start:dev` levanta la API y responde en `/health`.
- [ ] `clubos-next` levanta con `npm run dev` y pega contra la API local.
- [ ] Variables de entorno documentadas en un `.env.example` por proyecto.
- [ ] Un `README` de "cómo levantar todo desde cero" que funcione en una máquina limpia.

**Criterio de salida:** clonás en una máquina nueva, seguís el README, y en 15
minutos tenés backend + frontend + base corriendo con datos de demo.

---

## Fase 1 — Cobrar de verdad: MercadoPago (2–3 semanas)

Este es el desbloqueo #1. Sin esto no tenés propuesta de valor. En Argentina,
MercadoPago es obligatorio; Stripe es secundario.

**Dos flujos de cobro distintos — no confundirlos:**

### 1a. Cobro al jugador por una reserva (Checkout Pro)
- [ ] Módulo `payments-gateway` nuevo en el backend.
- [ ] Crear preferencia de pago (Checkout Pro) al confirmar reserva no pagada.
- [ ] Webhook de MercadoPago (`/webhooks/mercadopago`) que recibe la confirmación
      **asincrónica** — nunca confiar en el redirect del usuario, siempre en el webhook.
- [ ] Idempotencia: el webhook puede llegar duplicado. Guardar `mp_payment_id`
      único por club y no procesar dos veces.
- [ ] Al confirmarse, llamar al `payment.service` existente con `kind = MERCADO_PAGO`.
      **Reutilizás toda la lógica contable que ya está.** Solo le enchufás el trigger real.
- [ ] Manejar estados: `pending`, `approved`, `rejected`, `refunded`, `in_process`.
- [ ] Credenciales de MP **por club** (cada club cobra a su propia cuenta):
      guardar `mp_access_token` cifrado en la config del club. Esto es OAuth de
      MercadoPago (marketplace/split), más complejo que una sola cuenta — decidir
      temprano si arrancás con "cada club conecta su MP" (correcto) o "todo va a
      tu cuenta y vos repartís" (más simple pero implica que sos agente de retención).

### 1b. Cobro de la suscripción AL club (tu ingreso)
- [ ] Suscripción recurrente del club a su `Plan`. MercadoPago tiene
      *preapproval* (débito automático) para esto.
- [ ] Cron diario: clubes con `trialEndsAt` vencido y sin pago → `status = SUSPENDED`.
- [ ] Middleware que bloquea la API si el club está suspendido (excepto pantalla de pago).
- [ ] Enforcement de límites de plan: al crear cancha/usuario/cliente, chequear
      `maxCourts`/`maxUsers`/`maxClients` del `Plan`. La estructura ya está, falta el guard.

**Criterio de salida:** un cliente reserva, paga con MercadoPago, y el pago
aparece confirmado en la caja del club sin que nadie toque nada. Y un club que
no paga su suscripción queda suspendido automáticamente.

---

## Fase 2 — Onboarding real del club (1–2 semanas)

Hoy `auth.register` crea un usuario suelto. Falta el flujo que convierte
"una persona se registró" en "un club nuevo existe y funciona".

- [ ] Endpoint `POST /onboarding/club` transaccional que en un solo commit:
      crea el `Club` (con `slug` único, `status = TRIAL`, `trialEndsAt = +14 días`,
      `planId` = plan starter), crea el `User` owner, crea la `Membership`
      que los vincula con rol Dueño, y siembra config mínima (métodos de pago
      default, horarios default).
- [ ] Validación y reserva de `slug` (chequear disponibilidad en vivo, como dominio).
- [ ] Wizard de onboarding en el frontend: datos del club → primera cancha →
      horarios → listo. Máximo 3–4 pantallas.
- [ ] Resolución de tenant por subdominio (`clubxyz.clubos.com`) o por path,
      con middleware que setea el `tenant-context` desde el slug.
- [ ] Pantalla de "tu prueba vence en X días" + CTA a suscribirse.

**Criterio de salida:** alguien entra a la landing, se registra, y en 5 minutos
tiene su club creado con una cancha y puede recibir la primera reserva. Sin que
vos toques la base.

---

## Fase 3 — Notificaciones: WhatsApp + email (2 semanas)

Desbloqueo #2. En pádel argentino, la reserva y el recordatorio van por WhatsApp.
Sin esto el club sigue usando su grupo de WhatsApp a mano.

- [ ] Módulo `notifications` con una interfaz `NotificationChannel` (WhatsApp,
      email, push) para no acoplarse a un proveedor.
- [ ] WhatsApp: arrancar con un proveedor de la Cloud API (Meta directo, o
      intermediario tipo 360dialog / Wati / Gupshup para no pelear con Meta al inicio).
      Plantillas aprobadas: confirmación de reserva, recordatorio, cancelación,
      aviso de lista de espera liberada.
- [ ] Email transaccional (Resend, SendGrid o Postmark) para comprobantes.
- [ ] Cola con Redis (BullMQ) para envíos: no mandar sincrónico dentro del request.
- [ ] Cron de recordatorios: 24h y 2h antes de cada reserva. Marcar enviados
      para no duplicar.
- [ ] Registro de entregas (delivered/failed) por si hay que reintentar o auditar.

**Criterio de salida:** creo una reserva y al cliente le llega el WhatsApp de
confirmación; 24h antes le llega el recordatorio; todo automático y encolado.

---

## Fase 4 — Tests reales + CI (en paralelo, 2 semanas de esfuerzo)

Esto es tu terreno (QA + Playwright) y es lo que separa "demo" de "producto que
no se rompe cuando lo tocan tres empleados a la vez". Aprovechalo doble: es
infraestructura del producto **y** portfolio para tu transición a QA en 2027.

- [ ] Reemplazar los `verify-*.cjs` (que replican la lógica en paralelo, frágil)
      por Jest + `@nestjs/testing` que prueban el código real.
- [ ] Tests de integración contra una Postgres de test (Testcontainers o compose
      dedicado): que las transacciones de pago/caja realmente cuadren en la base.
- [ ] Un test que garantice el aislamiento multi-tenant: club A **nunca** ve datos
      de club B. Esto es crítico y vendible ("tus datos están aislados").
- [ ] E2E con Playwright sobre `clubos-next`: onboarding completo, crear reserva,
      pagar (con MP en sandbox), ver que aparece en caja.
- [ ] GitHub Actions: en cada PR corre typecheck + unit + integración. Merge
      bloqueado si algo falla.

**Criterio de salida:** un pipeline verde en cada push, con cobertura real del
flujo dinero (pago → caja → cierre) y del aislamiento entre clubes.

---

## Fase 5 — Operacional / producción (1–2 semanas)

Lo mínimo para poner esto en internet sin que se caiga o pierdas datos.

- [ ] Deploy real: backend (Railway/Render/Fly/VPS), frontend (Vercel), Postgres
      gestionada (Neon/Supabase/RDS) con backups automáticos diarios.
- [ ] Logs estructurados + Sentry (errores) + un uptime monitor.
- [ ] Rate limiting en endpoints sensibles (login, webhooks) — el `@nestjs/throttler`
      ya está, falta configurarlo en serio.
- [ ] HTTPS + wildcard para `*.clubos.com` (subdominios por club).
- [ ] Política de backups probada: no sirve el backup si nunca restauraste uno.
- [ ] Facturación fiscal AR: al menos generar comprobante y dejar preparada la
      integración AFIP/ARCA. Acá tenés ventaja por tu experiencia con ARCA/AFIP —
      podés hacerlo bien mientras la competencia lo hace mal.

**Criterio de salida:** está en internet, con backups, y si algo explota te enterás
por Sentry antes que por el cliente.

---

## Qué NO hacer todavía (fase 2 del negocio, después de 3–5 clubes pagando)

Todo esto está en el PRD y es tentador, pero no acerca el primer cliente:

- IA / predicción de demanda / sugerencia de precios (cero implementado hoy;
  no lo vendas como diferenciador hasta que exista).
- Marketing automático, campañas, cupones.
- Torneos avanzados con fixtures complejos (hay base de brackets, alcanza).
- App móvil nativa (la PWA responsive alcanza para empezar).
- Membresías, ranking, lista de espera con prioridad, check-in/check-out.
- Reportes avanzados y dashboard con IA.

---

## Secuencia recomendada y tiempo estimado

| Fase | Qué desbloquea | Estimado (1 dev) |
|---|---|---|
| 0 — Corre de verdad | Base para todo | 1 semana |
| 1 — MercadoPago | La propuesta de valor entera | 2–3 semanas |
| 2 — Onboarding | Que sea SaaS, no app de un club | 1–2 semanas |
| 3 — WhatsApp/email | Reemplaza el WhatsApp manual | 2 semanas |
| 4 — Tests + CI | Que no se rompa (y tu portfolio QA) | 2 semanas (en paralelo) |
| 5 — Producción | Ponerlo en internet sin miedo | 1–2 semanas |

**Total a MVP vendible: ~8–10 semanas** de foco de una persona, si no te
dispersás en features del PRD. El orden importa: 0 → 1 → 2 → 3 son la columna
vertebral. La 4 corre en paralelo. La 5 justo antes del primer cliente real.

---

## El hito que define "vendible"

Un dueño de club, sin que vos intervengas:
1. Entra a la landing, se registra, crea su club (Fase 2).
2. Carga sus canchas y horarios (ya existe).
3. Un jugador reserva y paga con MercadoPago (Fase 1).
4. Al jugador le llega la confirmación y el recordatorio por WhatsApp (Fase 3).
5. El dueño ve la plata en su caja y cierra el día (ya existe).
6. Cuando se le vence la prueba, paga la suscripción o queda suspendido (Fase 1b).

El día que ese ciclo entero funciona solo, tenés algo que cobrar.
