# Testing en ClubOS

Estrategia de tests del backend y frontend, y cómo correrlos.

## Filosofía

**Los tests prueban el código real, no una copia de su lógica.** Los antiguos
`verify-*.cjs` (ahora en `test/legacy/`) reimplementaban los algoritmos en
paralelo — su propio comentario decía "si cambia el algoritmo allá, cambiar
acá". Eso da falsa seguridad: si alguien cambia el código y olvida el test, el
test sigue verde con la lógica vieja. La suite nueva **importa las funciones y
clases de producción**, así que un cambio que rompe una regla rompe el test.

Ejemplo real: al escribir el test de `parsePolicy` se descubrió que la función
lee la política desde `settings.cancellationPolicy` (anidada), no desde un
objeto plano. El test que importa el código real lo expuso de inmediato; un
test que replicara la lógica jamás lo habría notado.

## Tipos de test

| Sufijo | Qué es | Necesita base | Comando |
|---|---|---|---|
| `*.spec.ts` | Unit: lógica pura | No | `npm run test:unit` |
| `*.int-spec.ts` | Integración: RLS, transacciones | Sí (Postgres) | `npm run test:int` |
| `*.e2e.ts` (front) | E2E de flujos con Playwright | Front + API | `npm run test:e2e` |

`npm test` corre unit + integración. Sin `DATABASE_URL_TEST`, los de
integración se **saltan** (no fallan), así que la suite unit corre en cualquier
lado sin infraestructura.

## Qué está cubierto hoy

**Unit (30 tests, todos verdes):**
- `cancellation-policy.spec.ts` — reembolsos por tramo de antelación, cancela
  cliente vs club, no-show, parseo de política. El dinero es lo más sensible.
- `crypto.service.spec.ts` — cifrado de tokens de MP: round-trip, unicidad del
  ciphertext, detección de manipulación (GCM), clave incorrecta.
- `mp-signature.spec.ts` — verificación de firma del webhook de Mercado Pago.
  Si esto se rompe, se podrían falsificar pagos: es seguridad crítica.
- `format.util.spec.ts` — fecha/hora en zona horaria del club (una reserva a
  las 19:00 en Buenos Aires no debe mostrarse en UTC) y formato de pesos.

**Integración (requiere Postgres):**
- `tenant-isolation.int-spec.ts` — **el test más importante de un SaaS**:
  verifica contra la base real que un club NUNCA ve datos de otro (RLS). Es
  correctitud, argumento de venta y garantía legal a la vez.

**E2E (frontend, Playwright):**
- `onboarding.e2e.ts` — un dueño crea su club de punta a punta por el wizard y
  cae logueado en la agenda.

## Correr localmente

```bash
# Unit (rápido, sin base)
cd clubos && npm run test:unit

# Integración (necesita Postgres de test)
cd clubos && npm run db:up          # levanta Postgres + Redis
DATABASE_URL_TEST=postgresql://clubos_owner:clubos_dev@localhost:5432/clubos \
  npm run test:int

# Cobertura
npm run test:cov

# E2E del frontend (necesita front + API corriendo)
cd clubos-next && npm run test:e2e
```

## CI

`.github/workflows/ci.yml` corre en cada push y PR:
- **backend**: typecheck + unit + integración (levanta Postgres, aplica schema
  + RLS, corre los `*.int-spec.ts`).
- **frontend**: typecheck + build + Playwright.
- **ci-ok**: gate final; configurar branch protection para bloquear el merge si
  algo falla.

## Lo que falta (próximas iteraciones)

- **Más integración:** el flujo de cobro completo (pago → caja → cierre cuadra),
  y el alta de club atómica (que un fallo a mitad no deje club colgado).
- **E2E full-stack en CI:** hoy el job de front hace build; falta un job que
  levante API + base y corra los E2E que dependen del backend (está comentado
  en el workflow, listo para habilitar).
- **Reemplazar del todo `test/legacy/`:** portar lo que valga de esos scripts a
  `*.spec.ts` reales y borrar la carpeta.
