# Módulo `onboarding` — Alta self-service de clubes

Convierte un formulario en un club operativo. Es lo que hace de ClubOS un SaaS
de verdad: cualquiera puede crear su club sin que vos toques la base.

## Qué hace

Un solo endpoint (`POST /onboarding/club`) crea, **de forma atómica**:

1. El **Club** (estado `TRIAL`, 14 días de prueba, plan starter por defecto).
2. Toda la **configuración por defecto**: roles del sistema, medios de pago
   (con comisiones reales de plaza AR), deporte pádel, etiquetas de CRM,
   categorías de gasto y producto, caja, horarios y lista de precios.
3. El **usuario dueño** (rol OWNER, permisos totales).
4. La **membresía** que liga dueño ↔ club.
5. Una **primera cancha**, para que la agenda no arranque vacía.

Si algo falla en el medio, no queda nada: nunca un club a medio armar.
Al terminar, el dueño queda **logueado** (devuelve la sesión iniciada).

## Backend

```
onboarding/
├── onboarding.controller.ts          POST /onboarding/club, GET /slug-available
├── onboarding.module.ts
├── dto/onboarding.dto.ts
└── services/
    ├── onboarding.service.ts         orquesta el alta atómica + login
    └── club-defaults.seeder.ts       versión transaccional de seedClubDefaults
```

Puntos de diseño:
- **Atomicidad:** todo el armado corre en una `$transaction`. Como el club aún
  no existe, se ejecuta bajo `runWithoutTenancy` (no hay RLS que aplicar
  todavía). Es el único lugar del sistema donde eso es correcto.
- **No duplica el seed:** `club-defaults.seeder.ts` es la versión que recibe
  `tx` de la función `seedClubDefaults` del seed (que ya estaba pensada "para
  el onboarding en producción"). Misma config, distinta plomería.
- **Login reutilizado:** tras crear el club, llama a `AuthService.login()` en
  vez de reimplementar la emisión de tokens. Un solo camino de sesión probado.
- **Slug:** validado (formato + reservados + unicidad). El chequeo en vivo no
  reserva el slug; el `@unique` de la BD es la garantía final.

## Frontend

```
clubos-next/src/
├── app/crear-club/            page.tsx + layout.tsx (importa auth.css)
├── components/OnboardingWizard.tsx   wizard de 3 pasos
├── styles/auth.css            estilos de login + wizard (ver nota abajo)
└── lib/api.ts                 + namespace api.onboarding
```

Wizard de 3 pasos: club (con slug en vivo) → cuenta del dueño → confirmar.
Al crear, guarda la sesión (igual que el login) y redirige a `/agenda`.

> **Nota sobre `auth.css`:** el proyecto importaba `@/styles/auth.css` desde
> el layout de `/entrar`, pero el archivo **no existía** en el ZIP (faltaba
> desde antes). Se creó ahora, reconstruyendo las clases que usa `LoginScreen`
> (`auth-card`, `field`, `input`, `btn`…) con la paleta de marca de `Art.tsx`,
> más las clases del wizard. Esto además arregla el login, que renderizaba sin
> estilos.

## Probar de punta a punta (local)

Con el backend y la base levantados:

```bash
# 1. Verificar slug libre
curl "http://localhost:3001/api/v1/onboarding/slug-available?slug=mi-club"
# → { "slug": "mi-club", "available": true }

# 2. Crear el club
curl -X POST http://localhost:3001/api/v1/onboarding/club \
  -H "Content-Type: application/json" \
  -d '{
    "clubName": "Pádel Center San Isidro",
    "slug": "mi-club",
    "firstName": "Alejo",
    "lastName": "Pérez",
    "email": "alejo@miclub.com.ar",
    "password": "Prueba1234"
  }'
# → { "club": {...}, "session": { "accessToken": "...", "permissions": [...] } }
```

Desde la UI: andá a `/crear-club`, completá el wizard, y al terminar deberías
caer en `/agenda` ya logueado, con una cancha y los horarios cargados.

### El ciclo completo que valida la Fase 2 + Fase 1 juntas
1. Creás un club desde `/crear-club` (este módulo).
2. Entrás a configuración → conectás Mercado Pago (módulo `payments-gateway`).
3. Creás una reserva y la cobrás online.
4. Llega el webhook, el pago cae en la caja del club.

Recién cuando ese ciclo entero corre solo, tenés algo vendible.

## Lo que queda para después (no incluido)

- **Resolución por subdominio** (`miclub.clubos.com`): hoy el club se crea con
  su `slug`, pero falta el middleware que resuelva el tenant desde el subdominio
  en cada request. Por ahora se opera con el club activo de la sesión.
- **Verificación de email** del dueño (se crea con `emailVerified: false`).
- **Recordatorio de fin de trial** + bloqueo al vencer (esto engancha con la
  suscripción del club, Fase 1b del roadmap).
- **Tests:** unit del `slugify`/validación y un e2e del alta atómica (que un
  fallo a mitad no deje club colgado). Fase 4, tu terreno de QA.
