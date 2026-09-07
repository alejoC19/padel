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
│   ├── schema.prisma          (54 modelos, incluye Invoice/InvoiceItem)
│   ├── seed.ts
│   └── migrations/manual/001_integrity_and_rls.sql
├── db/init/                   01-extensions.sql, 02-app-role.sql
├── test/                      verify-*.cjs, verify-*.mjs, smoke-test.mjs, e2e-day.mjs
├── package.json
├── tsconfig.json
├── docker-compose.yml
└── README.md                  (README original del backend)
```

### Puesta en marcha
```bash
cd clubos
npm install
docker compose up -d          # levanta PostgreSQL + Redis
npx prisma migrate dev        # aplica el schema
npx prisma db seed            # datos de prueba
npm run start:dev
```

### Tests
Los scripts de verificación viven en `test/`. Ejemplos:
```bash
node test/verify-time.cjs
node test/verify-money.cjs
node test/smoke-test.mjs
node test/e2e-day.mjs
```

---

## 2. `clubos-next/` — Frontend (Next.js 15)

```
clubos-next/
├── src/
│   ├── app/                   rutas: agenda, caja, buffet, clientes,
│   │                          tesoreria, torneos, reportes, entrar
│   ├── components/            AgendaScreen, CashScreen, ClientsScreen, POS,
│   │                          TreasuryScreen, ReportsScreen, TournamentsScreen,
│   │                          BookingPanel, TimeGrid, etc.
│   │   └── marketing/         Art.tsx, HeroAgenda.tsx
│   ├── hooks/                 index.ts
│   └── lib/                   api.ts, agenda-store.ts, grid.ts, demo-data.ts
├── next.config.mjs
├── package.json
├── tsconfig.json
├── verify-grid.cjs
└── verify-store.cjs
```

### Puesta en marcha
```bash
cd clubos-next
npm install
npm run dev
```

Los imports usan el alias `@/` → `src/` (configurado en `tsconfig.json`).

---

## 3. `clubos-web/` — Prototipos estáticos

Landing, login y agenda en HTML plano (versión previa / demo visual).
```
clubos-web/
├── landing.html
├── agenda.html
├── login.html
├── package.json
├── tsconfig.json
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
