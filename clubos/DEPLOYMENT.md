# ClubOS — Guía de puesta en producción (Fase 5)

Cómo poner ClubOS en internet sin que se caiga ni pierda datos. Es la lista
concreta de lo que hay que hacer, en orden.

---

## Arquitectura de deploy recomendada

| Pieza | Dónde | Por qué |
|---|---|---|
| **Backend** (API NestJS) | Railway / Render / Fly.io / VPS | Corre el Dockerfile incluido. Empezá con el más simple (Railway/Render). |
| **Frontend** (Next.js) | Vercel | Es su hábitat natural; deploy por git push. |
| **Base de datos** (Postgres) | Neon / Supabase / RDS | Gestionada, con backups automáticos del proveedor **además** de los tuyos. |
| **Redis** | Upstash / el del proveedor | Para colas/cache. Ya está en el stack. |
| **Archivos** (fotos canchas) | S3 / R2 | Cuando se implemente subida de imágenes. |

Para arrancar con pocos clubes, Railway (API + Postgres + Redis en un proyecto)
+ Vercel (front) es lo más rápido y barato. Migrás a algo más robusto cuando el
volumen lo pida.

---

## Checklist de primer deploy

### 1. Base de datos

> ⚠️ **Dos connection strings, no una.** Todo lo de abajo que crea/altera
> objetos (rol, extensiones, tablas, políticas RLS) se corre con
> `DIRECT_URL` — la del **owner** que te da el proveedor gestionado. El
> backend en runtime usa `DATABASE_URL` — el rol restringido `clubos_app`
> que crea el paso (a), sujeto a RLS. Correr estos pasos con `DATABASE_URL`
> falla: `clubos_app` no tiene permiso para crear su propio rol ni para
> alterar tablas.

```bash
# En la base gestionada (Neon/Supabase/RDS), una vez creada:
# a) extensiones y rol de aplicación (con el owner: DIRECT_URL)
psql "$DIRECT_URL" -f db/init/01-extensions.sql
psql "$DIRECT_URL" -f db/init/02-app-role.sql
# b) schema (usa DIRECT_URL — configurado en prisma/schema.prisma)
npx prisma migrate deploy
# c) políticas RLS (CRÍTICO: sin esto no hay aislamiento entre clubes)
psql "$DIRECT_URL" -f prisma/manual/001_integrity_and_rls.sql
# d) datos base (planes, etc.) — el seed usa DIRECT_URL solo si está seteada
npm run db:seed
```

> ⚠️ **La RLS no es opcional.** Es lo que garantiza que un club no vea datos de
> otro. Verificá que se aplicó corriendo el test de aislamiento contra la base,
> ahora sí con el rol restringido: `DATABASE_URL_TEST="$DATABASE_URL" npm run test:int`.

### 2. Variables de entorno
Copiá `.env.example` y completá **todo**. Las imprescindibles en prod:
- `DATABASE_URL` (rol restringido `clubos_app` — la usa el backend en
  runtime) **y** `DIRECT_URL` (rol owner — la usan `prisma migrate deploy`
  y el paso de release; guardala, la necesitás cada vez que migrás)
- `NODE_ENV=production`, `PORT`
- `JWT_ACCESS_SECRET` (largo y aleatorio — `openssl rand -base64 48`)
- `PAYMENTS_ENC_KEY` (≥32 chars — **backupealo en el secret manager**)
- `API_PUBLIC_URL`, `WEB_PUBLIC_URL`, `CORS_ORIGINS`
- MercadoPago: `MP_APP_ID`, `MP_APP_SECRET`
- Notificaciones: `WHATSAPP_*`, `RESEND_API_KEY`, `EMAIL_FROM`
- Opcional: `SENTRY_DSN`

### 3. Backend
El `Dockerfile` está listo (multi-stage, no-root, healthcheck). En Railway/
Render apuntás al repo y detecta el Dockerfile. Configurá:
- **Health check path:** `/health` (liveness) — reinicia si falla.
- **Readiness** (si el proveedor lo soporta): `/health/ready` — saca del
  balanceo si la base está caída, sin reiniciar.
- La migración **no** corre en el arranque del contenedor (a propósito): corré
  `npx prisma migrate deploy` como paso de release, no en el CMD. Así un deploy
  no aplica migraciones a medias si hay varias instancias.

### 4. Frontend (Vercel)
- Root del proyecto: `clubos-next`.
- Variable: `NEXT_PUBLIC_API_URL` apuntando a `API_PUBLIC_URL`.
- Deploy automático por push a `main`.

### 5. Subdominios de club
Los clubes se crean con su `slug` (`miclub.clubos.com`). Para que funcione:
- Wildcard DNS: `*.clubos.com` → tu frontend.
- Certificado wildcard (Vercel/Cloudflare lo gestionan solo).
- **Pendiente de código:** el middleware que resuelve el tenant desde el
  subdominio (hoy se opera con el club activo de la sesión). Ver README de
  onboarding.

### 6. HTTPS y CORS
- HTTPS lo dan Vercel/Railway/Render por defecto.
- `CORS_ORIGINS` debe listar exactamente tus dominios de front (incluí los
  subdominios de club si aplican).

---

## Observabilidad (ya cableada)

- **Logs estructurados:** en `NODE_ENV=production` la API emite una línea JSON
  por evento, con `requestId` y `clubId`. Cualquier agregador (el panel del
  proveedor, Loki, Datadog) los indexa. Para seguir una request entera, filtrá
  por `requestId`.
- **Errores 5xx:** el filtro global los captura, loguea con contexto y —si
  configurás Sentry— los reporta. Para activar Sentry: `npm i @sentry/node`,
  setear `SENTRY_DSN`, y descomentar el init en
  `src/common/observability/error-reporter.ts`.
- **Health:** `/health` y `/health/ready` para el orquestador y para un uptime
  monitor externo (UptimeRobot, Betterstack) que te avise si se cae.

---

## Backups (script incluido)

Los proveedores gestionados hacen backups, pero tener los tuyos propios te
protege de borrar la base por error o de dejar el proveedor.

```bash
# Backup manual
DATABASE_URL="$DATABASE_URL" ./scripts/backup.sh

# Con subida a S3
BACKUP_S3_BUCKET=s3://mi-bucket/clubos DATABASE_URL="$DATABASE_URL" ./scripts/backup.sh

# Cron diario (3 AM)
0 3 * * * cd /app && DATABASE_URL=$DATABASE_URL ./scripts/backup.sh >> /var/log/clubos-backup.log 2>&1
```

> ⚠️ **Un backup que nunca restauraste no es un backup.** Cada tanto, probá la
> restauración contra una base de prueba:
> ```bash
> TARGET_DATABASE_URL="$TEST_DB" ./scripts/restore.sh ./backups/clubos_XXXX.dump
> ```
> El script te frena si detecta que apuntás a algo que parece producción.

---

## Rate limiting (endurecido)

- Global: 10 req/s y 120 req/min por IP (ya estaba).
- Login: 5/min. Register: 3/5min. (Ya estaban — buen trabajo de quien los puso.)
- Alta de club: 3 cada 10 min por IP (nuevo — frena spam de altas).
- Webhook de MP: exento del límite (MP manda ráfagas legítimas; la seguridad
  del webhook es la firma, no el rate limit).

---

## Fiscal AR (tu ventaja competitiva)

El schema ya tiene `Invoice`/`InvoiceItem`. La integración con AFIP/ARCA
(facturación electrónica, CAE, puntos de venta) es donde tu experiencia en
Taurusmania te pone por delante de la competencia. No es bloqueante para el
primer cliente, pero es un diferenciador real para el mercado argentino y
conviene planificarlo temprano en el modelado fiscal (condición IVA del club,
tipos de comprobante A/B/C, numeración por punto de venta).

---

## Orden sugerido para el primer club real

1. Base gestionada + migración + RLS + verificar aislamiento con el test.
2. Backend con Dockerfile + health checks + logs + (opcional) Sentry.
3. Front en Vercel.
4. Backups automáticos + probar una restauración.
5. Uptime monitor externo apuntando a `/health`.
6. Crear tu propio club (onboarding), conectar MercadoPago, hacer una reserva
   de prueba y cobrarla: el ciclo completo end-to-end en producción.
7. Recién ahí, invitar al primer club real.
