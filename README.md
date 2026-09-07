# ClubOS — Monorepo

SaaS ERP multi-tenant para clubes de pádel. Este repositorio reúne los tres
proyectos que componen el producto, reorganizados en su estructura de carpetas
correcta y sin archivos duplicados.

## Estructura

```
clubos-project/
├── clubos/          → Backend (NestJS + Prisma + PostgreSQL)
├── clubos-next/     → Frontend de producción (Next.js 15 + React + TS)
└── clubos-web/      → Prototipos HTML estáticos (landing, login, agenda)
```

---

## 1. `clubos/` — Backend (NestJS)

```
clubos/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/
│   │   ├── permissions.ts
│   │   ├── decorators/        (index.ts)
│   │   ├── guards/            (tenant, jwt-auth, permissions)
│   │   └── filters/           (prisma-exception.filter)
│   ├── tenancy/
│   │   └── tenant-context.ts
│   ├── prisma/
│   │   ├── prisma.service.ts
│   │   └── prisma.module.ts
│   ├── auth/                  controller, service, token.service, dto/
│   ├── bookings/             agenda / availability / booking / pricing /
│   │                          payment / club-config / document-number,
│   │                          time.util, cancellation-policy, dto/, services/
│   ├── cash/                  cash.controller, cash-balance, services/, dto/
│   ├── clients/              client + client-search, services/, dto/
│   ├── pos/                   pos + stock, services/, dto/
│   ├── reports/              daily-close + profitability, services/, dto/
│   ├── tournaments/          tournament + bracket, services/, dto/
│   └── treasury/             treasury + expense + cash-flow, services/, dto/
├── prisma/
│   ├── schema.prisma          (modelos de negocio, ver el archivo)
│   ├── seed.ts
│   ├── migrations/            migraciones reales de Prisma
│   └── manual/001_integrity_and_rls.sql   (RLS, EXCLUDE constraints, triggers)
├── db/init/                   01-extensions.sql, 02-app-role.sql (rol clubos_app)
├── test/                      unit/, integration/ (Jest)
├── scripts/                   verify-*.cjs, verify-*.mjs, smoke-test.mjs, e2e-day.mjs
├── package.json
├── tsconfig.json
├── docker-compose.yml
└── README.md                  (detalle de arquitectura del backend)
```

### Puesta en marcha
La forma más simple es `bash start.sh` desde `clubos/` (ver `clubos/README.md`
y `EMPEZAR-ACA.md` en la raíz) — levanta Postgres/Redis con Docker, aplica
migraciones + RLS + seed, y deja todo listo. Manual, paso a paso:
```bash
cd clubos
npm install
docker compose up -d db redis
cp .env.example .env          # completar DATABASE_URL / DIRECT_URL — ver abajo
npx prisma generate
npx prisma migrate deploy     # crea las tablas (usa DIRECT_URL)
psql "$DIRECT_URL" -f db/init/01-extensions.sql
psql "$DIRECT_URL" -f db/init/02-app-role.sql
psql "$DIRECT_URL" -f prisma/manual/001_integrity_and_rls.sql
npm run db:seed
npm run start:dev
```

**`DATABASE_URL` vs `DIRECT_URL`:** el backend corre con el rol restringido
`clubos_app` (`DATABASE_URL`), sujeto a Row-Level Security; las migraciones
corren con el rol owner (`DIRECT_URL`), que tiene permiso de crear tablas.
Usar el owner como `DATABASE_URL` en runtime bypasea RLS por completo — ver
`clubos/README.md` "Conexión: usar el rol correcto".

### Tests
```bash
npm test                      # unit + integración (Jest)
npm run test:unit             # solo unit, sin base de datos
DATABASE_URL_TEST=... npm run test:int   # integración: RLS, concurrencia de caja, etc.
npm run verify                 # scripts/verify-*.cjs — algoritmos puros, sin base
```

---

## 2. `clubos-next/` — Frontend (Next.js 15)

```
clubos-next/
├── src/
│   ├── app/
│   │   ├── agenda/ caja/ buffet/ clientes/ tesoreria/ torneos/ reportes/
│   │   │   → panel del club (staff logueado). Cada ruta está protegida por
│   │   │     RouteGuard además del guard del backend — ver src/components/
│   │   │     RouteGuard.tsx.
│   │   ├── entrar/ crear-club/  → login y alta de club (self-service)
│   │   └── (ver el árbol real para las rutas públicas del jugador — sin
│   │        login, bajo el slug del club)
│   ├── components/            AgendaScreen, CashScreen, ClientsScreen, POS,
│   │                          TreasuryScreen, ReportsScreen, TournamentsScreen,
│   │                          BookingPanel, RouteGuard, etc.
│   │   └── marketing/         Art.tsx, HeroAgenda.tsx
│   ├── hooks/                 index.ts (useSession: isAuthenticated/isDemo/can)
│   └── lib/                   api.ts, agenda-store.ts, grid.ts, demo-data.ts
├── next.config.mjs
├── package.json
├── tsconfig.json
├── verify-grid.cjs             (algoritmos de grilla/horarios, sin backend)
└── verify-store.cjs            (agenda-store, sin backend)
```

### Puesta en marcha
```bash
cd clubos-next
npm install
npm run dev
```

Los imports usan el alias `@/` → `src/` (configurado en `tsconfig.json`).

---

## 3. `clubos-web/` — Prototipos estáticos (obsoleto)

Landing, login y agenda en HTML plano — la etapa previa a `clubos-next`, que
es la implementación real y mantenida. Se conserva solo como referencia
visual; no tiene build ni tests propios (ver `clubos-web/README.md`).
```
clubos-web/
├── landing.html
├── agenda.html
├── login.html
└── README.md
```
Abrir cualquiera de los `.html` directamente en el navegador.

---

## Notas sobre esta reorganización

- Los archivos venían **aplanados en la raíz** del ZIP original y con
  **duplicados** (`*-clubos.html` idénticos, dos copias del `schema.prisma`).
- Se conservó, en cada caso, la **versión más completa**:
  - `schema.prisma`: 54 modelos (incluye facturación `Invoice`/`InvoiceItem`).
  - `001_integrity_and_rls.sql`: 342 líneas (versión con RLS completa).
- La estructura de carpetas del backend se **reconstruyó a partir de los
  imports** de cada archivo (`../../prisma/prisma.service`,
  `./services/...`, `../common/...`, etc.), de modo que las rutas relativas
  ahora resuelven correctamente.
