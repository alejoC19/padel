# ClubOS — Backend

SaaS multi-tenant de gestión para clubes deportivos.
NestJS + Prisma + PostgreSQL 16.

## Puesta en marcha

```bash
cp .env.example .env          # ajustar secretos
npm install
npm run db:up                 # Postgres + Redis en Docker
npx prisma migrate dev        # tablas desde schema.prisma
npm run db:manual             # constraints, RLS, triggers, funciones
npm run db:seed               # planes + club demo
npm run start:dev
```

Login del club demo: `owner@clubdemo.com.ar` / `Demo1234!`

## Verificación

```bash
npm run verify                # 171 tests de algoritmos (sin BD)
npm run smoke                 # 115 tests contra Postgres real
npm run e2e                   # un día completo del club, de punta a punta
```

`verify` cubre rotación de tokens, conversiones de zona horaria,
solapamiento de turnos, resolución de precios, cálculos de dinero y
arqueo de caja.

`e2e` simula un día real: abrir caja, reservar, cobrar, vender en el buffet,
pagar un gasto y cerrar con arqueo. Es lo que verifica que los módulos
encajen entre sí — que la plata que entra por la agenda aparezca en la caja
y que el cierre cuadre con todo lo anterior.

`smoke` cubre lo que solo se puede probar con la base arriba: el EXCLUDE
constraint bajo concurrencia, aislamiento RLS, triggers append-only,
numeración atómica y atomicidad de transacciones.

## Por qué `db:manual` no es opcional

`prisma migrate` crea las tablas, pero Prisma no puede expresar cuatro
cosas de las que depende la integridad del sistema:

**1. Doble reserva.** El `EXCLUDE USING gist` sobre `tstzrange` hace
imposible que dos reservas activas se solapen en la misma cancha. Validar
esto en la aplicación pierde siempre ante concurrencia: dos requests leen
"libre" y ambas insertan. Verificado con 10 inserts simultáneos sobre el
mismo turno — exactamente uno sobrevive.

**2. Aislamiento entre clubes.** `clubId` en cada tabla no alcanza: un
`WHERE` olvidado en un solo endpoint filtra datos de un club a otro. Las
políticas RLS lo hacen imposible incluso con código con bugs.

**3. Libros append-only.** Caja, cuenta corriente, stock y auditoría no
admiten `UPDATE` ni `DELETE`. Un error se corrige con contra-asiento. Lo
garantizan triggers, no la disciplina del equipo.

**4. Numeración sin huecos.** `COUNT(*)+1` duplica números con dos
recepcionistas trabajando a la vez. `next_document_number()` usa
`INSERT ... ON CONFLICT DO UPDATE RETURNING`, atómico por definición.

## Conexión: usar el rol correcto

El backend se conecta con `clubos_app`, **nunca** con el owner. El owner
bypassea RLS salvo `FORCE` (está activado), pero usar el rol correcto es
defensa en profundidad: si una migración futura quita el `FORCE`, el
aislamiento sigue en pie.

```
DATABASE_URL="postgresql://clubos_app:...@localhost:5432/clubos"   # app
DIRECT_URL="postgresql://clubos_owner:...@localhost:5432/clubos"   # migraciones
```

## Arquitectura

```
src/
  tenancy/       AsyncLocalStorage con el club activo
  prisma/        PrismaService que fuerza SET LOCAL en cada transacción
  common/        guards (auth → tenant → permisos), filtros, permisos
  auth/          login, refresh rotation con detección de reuso
  bookings/      agenda, disponibilidad, precios, reservas, cobros
  cash/          turnos de caja, movimientos, arqueo, cierre
  clients/       CRM: búsqueda, ficha, cuenta corriente, etiquetas
  pos/           buffet: venta, kardex de stock, compras, ajustes
  reports/       cierre de día, rentabilidad por producto y cancha
  treasury/      bancos, conciliación, flujo de fondos, gastos
  tournaments/   fixture por formato, resultados, tabla de posiciones
```

**Orden de guards** (no reordenar): Throttler → JwtAuth → Tenant →
Permissions. `TenantGuard` resuelve la membresía y monta el contexto;
`PermissionsGuard` lee ese contexto. Invertirlos rompe todo.

**Acceso a datos:** los servicios usan `prisma.db.*` (tenant-scoped), no
`prisma.*`. El cliente base solo sirve para tablas de plataforma (User,
Club, Session). Una query de negocio sin club activo lanza excepción en
vez de devolver datos de otro club.

**Transacciones:** cuando un caso de uso escribe varias entidades
relacionadas, usar `prisma.tenantTransaction()`. Setea el club una sola
vez en vez de una transacción por query.

## Estado

| Módulo | Estado |
|---|---|
| Tenancy + RLS | verificado contra Postgres |
| Auth | completo |
| Agenda / disponibilidad | completo |
| Precios | completo |
| Reservas + cobro | completo |
| Caja (apertura/cierre/arqueo) | completo |
| CRM / Clientes | completo |
| Buffet / POS + stock | completo |
| Reportes: cierre de día y rentabilidad | completo |
| Tesorería: bancos, conciliación, gastos | completo |
| Torneos: fixture, resultados, tablas | completo |
| Frontend — agenda | prototipo funcional |
| Frontend — landing | completo |

## Endpoints principales

```
GET  /agenda/day?date=YYYY-MM-DD    tablero completo del día (1 llamada)
GET  /agenda/availability            horarios libres, para cotizar
POST /agenda/quote                   precio de un turno

POST /bookings                       crear (+ cobrar en la misma transacción)
POST /bookings/:id/reschedule        mover (crea una reserva nueva encadenada)
POST /bookings/:id/cancel            cancelar + devolución según política
POST /bookings/:id/collect           cobrar saldo pendiente

GET  /clients/search?q=              búsqueda tolerante a acentos y tipeos
GET  /clients/:id/statement          extracto de cuenta corriente

POST /cash/sessions                  abrir turno de caja
POST /cash/sessions/:id/close        cerrar con arqueo

POST /pos/sales                      vender en el buffet (stock + caja)
GET  /pos/stock/alerts               qué reponer
POST /pos/stock/purchase             recibir mercadería

GET  /reports/daily-close?date=      cómo fue el día, en una pantalla
GET  /reports/products?from=&to=     qué producto deja más plata
GET  /reports/courts?from=&to=       facturación por hora de cada cancha
GET  /reports/occupancy?from=&to=    dónde están los huecos

POST /treasury/accounts/:id/import   importar extracto (idempotente)
GET  /treasury/accounts/:id/suggestions  qué conciliar con qué
GET  /treasury/cash-flow?days=30     ¿me alcanza para pagar el viernes?
POST /treasury/expenses              registrar obligación (no mueve plata)
POST /treasury/expenses/:id/pay      pagar (acá sí sale la plata)
```

El cierre de día distingue tres cifras que suelen confundirse:
**facturado** (lo vendido), **cobrado** (lo que entró) y **pendiente**.
Mezclarlas es cómo un club cree que tuvo un buen día y a fin de mes no le
cierra la plata.

`/agenda/day` y `/agenda/availability` parecen redundantes pero responden
preguntas distintas: el primero devuelve todo lo que la grilla dibuja
(cliente, estado, saldo); el segundo solo los huecos libres. Forzar que uno
sirva para ambas cosas devuelve de más en un caso y de menos en el otro.

## Sobre facturación

ClubOS **no emite comprobantes fiscales**. No hay integración con ARCA/AFIP
ni intención de agregarla.

Es una decisión de alcance, no una omisión: la factura electrónica exige
certificados fiscales del club, homologación con el organismo y
responsabilidad legal sobre cada comprobante emitido. Un club chico ya
resuelve eso con el sistema de su contador, y meterlo acá agregaría una
superficie de riesgo grande a cambio de poco.

Lo que sí hace el sistema:

- numera comprobantes internos (el papel que se le da al cliente)
- registra el tipo y número de la factura del proveedor en cada gasto
- exporta los datos que el contador necesita para facturar por su lado

## Limitaciones conocidas

- Los smoke tests validan constraints e integridad a nivel motor, no los
  servicios de NestJS. Faltan tests de integración de los casos de uso.
- El cache de configuración del club es por proceso (TTL 5 min). Con
  varias instancias, un cambio de zona horaria tarda hasta 5 minutos en
  propagarse. Mover a Redis si eso llega a importar.
- `AuditLog` crecerá rápido. Particionar por mes al superar ~50M filas.
