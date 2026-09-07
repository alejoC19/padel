# ClubOS — Web

Next.js 15 (App Router) + React 19 + TypeScript.
Landing pública, login y agenda operativa en un solo proyecto.

## Correr

```bash
npm install
npm run dev          # http://localhost:3001
```

Sin backend levantado la agenda arranca en **modo demostración**: datos de
ejemplo y un cartel que lo aclara. Una pantalla que finge estar conectada es
peor que una que avisa que no lo está — si el operador cree que guardó un
turno y no se guardó, el problema aparece cuando el cliente llega al club.

Con backend:

```bash
API_URL=http://localhost:3000 npm run dev
```

El rewrite de Next manda `/api/*` al backend. Evita configurar CORS y, más
importante, hace que la cookie httpOnly del refresh token viaje sin dominios
cruzados — que es donde suele romperse la sesión al pasar a producción.

## Rutas

| Ruta | Tipo | Por qué |
|---|---|---|
| `/` | Server Component | Landing pública: se indexa sin ejecutar JS |
| `/entrar` | Cliente | Formulario con estado |
| `/agenda` | Cliente | Arrastre, atajos, refresco automático |
| `/caja` | Cliente | Apertura, movimientos, arqueo y cierre |
| `/buffet` | Cliente | Punto de venta con cálculo de vuelto |
| `/clientes` | Cliente | Búsqueda en vivo y ficha lateral |
| `/reportes` | Cliente | Cierre de día |
| `/tesoreria` | Cliente | Flujo de fondos y gastos por vencer |
| `/torneos` | Cliente | Cuadro, tabla y carga de resultados |

Todas las pantallas internas comparten `AppShell`, que filtra la navegación
por permiso: recepción no ve "Reportes". No es estética — un link que lleva a
un 403 enseña al operador a ignorar los mensajes de error.

## Scripts

```bash
npm run dev
npm run build        # build de producción
npm run start        # servidor de producción
npm run typecheck
npm run verify       # 30 tests de lógica
```

## Dónde Next aporta y dónde no

**Aporta en la landing.** Se renderiza en el servidor, llega como HTML
completo con sus meta tags, y Google la indexa sin ejecutar JavaScript. Para
una página que vende, eso importa.

**No aporta en la agenda.** Es una herramienta interna detrás de login: no
hay SEO que ganar y el contenido depende de un token que vive en el
navegador. Va como componente cliente.

Esa mezcla es la razón de usar Next para todo el proyecto en vez de separar
landing y app: un solo despliegue, un solo build, y cada ruta elige su
estrategia.

## Fricciones de SSR que hubo que resolver

Prerenderizar la agenda rompía el build dos veces. Ambos casos están
resueltos y conviene no reintroducirlos:

**`useSyncExternalStore` necesita `getServerSnapshot`.** Sin el tercer
argumento, el build falla entero. Devuelve el mismo estado que el cliente
porque el store arranca vacío: en el servidor no hay sesión ni datos.

**`sessionStorage` no existe en el servidor.** `readSession()` chequea
`typeof window` antes de tocarlo, y `useSession` arranca en `null` y lee
después de montar. Si el estado inicial dependiera de sessionStorage, el HTML
del servidor y el del cliente diferirían y React tiraría un error de
hidratación.

## Decisiones que conviene no revertir sin pensarlo

**El store no es estado de React.** `agenda-store.ts` es una clase con la
lógica de optimismo, reversión y control de carreras, probada sin DOM. React
se suscribe con `useSyncExternalStore`, que además evita el tearing en modo
concurrente.

**Mover un turno es optimista; cobrar y cancelar no.** Arrastrar y esperar a
que el bloque salte se siente roto, y el estado previo de un movimiento es
recuperable exactamente. En cambio el neto de un cobro depende de la comisión
del medio de pago y la devolución de una cancelación depende del tramo de
antelación: los calcula el servidor.

**El token va en sessionStorage, no en localStorage.** localStorage sobrevive
al cierre del navegador. En una recepción con computadora compartida, la
sesión debe morir con la pestaña.

**El login nunca dice cuál campo falló.** "Email o contraseña incorrectos"
para las dos cosas. Distinguirlos permite averiguar qué emails están
registrados.

**Los gráficos de pádel son SVG embebido, no imágenes.** Una landing que
vende no puede depender de que un CDN de terceros responda: si falla, quedan
cuadros rotos justo cuando alguien la está evaluando.

**`noUncheckedIndexedAccess` está activado.** Encontró un bug real:
`date.split('-')` puede devolver menos elementos de los esperados y eso
rompía con un `undefined` silencioso más adelante.
