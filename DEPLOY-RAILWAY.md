# ClubOS — Deploy a producción en Railway (paso a paso)

Guía para poner ClubOS en internet, funcionando 24/7, sin tu PC prendida.
Railway aloja el **backend** y la **base de datos** juntos. El **frontend**
(panel del club) va en Vercel. La **app del jugador** después apunta al backend
en la nube.

Tiempo estimado: 1–2 horas la primera vez. Andá sin apuro.

---

## Antes de empezar

- Cuenta en Railway (railway.app) — se crea con GitHub, gratis para empezar.
- Tu proyecto ClubOS subido a un repositorio de GitHub (si no lo tenés, primero
  hacé eso: crear repo, `git push`).
- Cuenta en Vercel (vercel.com) para el frontend — también gratis, con GitHub.

---

## PARTE 1 — La base de datos

1. En Railway, **New Project** → **Provision PostgreSQL**.
2. Cuando esté creada, entrá a la base → pestaña **Variables** → copiá la
   `DATABASE_URL` (empieza con `postgresql://...`). Guardala, la vas a usar.

---

## PARTE 2 — Preparar la base (una sola vez)

La base está vacía. Hay que crear las tablas, la seguridad (RLS) y los datos
base. Desde tu PC, en la carpeta `clubos`:

```bash
DATABASE_URL="<la-que-copiaste-de-railway>" bash setup-produccion.sh
```

Esto crea todo. Si te avisa que `psql` no está instalado para el paso del RLS,
aplicá el archivo `prisma/rls/001_integrity_and_rls.sql` desde la consola SQL de
Railway (pestaña **Data** → **Query**).

> ⚠️ El RLS es la seguridad multi-tenant. No lo saltees: sin él, un club vería
> los datos de otro.

---

## PARTE 3 — El backend

1. En el mismo proyecto de Railway: **New** → **GitHub Repo** → elegí tu repo
   de ClubOS. Si el backend está en una subcarpeta (`clubos/`), configurá el
   **Root Directory** = `clubos` en Settings.
2. Railway detecta el `Dockerfile` y el `railway.json` solos.
3. Andá a **Variables** del servicio del backend y agregá:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | La de tu base (Railway te deja referenciarla) |
   | `NODE_ENV` | `production` |
   | `JWT_ACCESS_SECRET` | Uno largo y aleatorio (ver abajo) |
   | `ACCESS_TOKEN_TTL` | `900` |
   | `REFRESH_TOKEN_TTL_DAYS` | `30` |
   | `PAYMENTS_ENC_KEY` | Uno largo y aleatorio (ver abajo) |
   | `CORS_ORIGINS` | La URL de tu frontend en Vercel (la ponés en la Parte 4) |
   | `LOG_QUERIES` | `false` |

   Para generar los secretos, en tu PC:
   ```bash
   openssl rand -base64 48
   ```
   Corrélo dos veces, uno para cada secreto.

4. Railway despliega solo. Cuando termine, te da una URL pública
   (algo como `clubos-production.up.railway.app`).
5. Probala: abrí `https://esa-url/health` → tenés que ver `{"status":"ok"}`.

---

## PARTE 4 — El frontend (panel del club) en Vercel

1. En Vercel: **Add New** → **Project** → importá tu repo de GitHub.
2. **Root Directory** = `clubos-next`.
3. En **Environment Variables** agregá:
   - `NEXT_PUBLIC_API_URL` = `https://<tu-backend-de-railway>/api/v1`
4. Deploy. Vercel te da una URL (`clubos-xxx.vercel.app`).
5. **Importante:** volvé a Railway → Variables del backend → poné esa URL de
   Vercel en `CORS_ORIGINS`. Guardá (el backend se reinicia solo). Sin esto, el
   panel no puede hablar con la API por seguridad de CORS.

---

## PARTE 5 — La app del jugador

En `clubos-player-app/src/lib/api.js`, cambiá:
```js
export const API_BASE = 'https://<tu-backend-de-railway>/api/v1';
```
(antes apuntaba a tu IP local). Ahora la app funciona desde cualquier celular,
en cualquier red, sin tu PC.

---

## Verificación final

1. `https://<backend>/health` responde `ok`.
2. Entrás al panel (URL de Vercel) y podés loguearte con el club demo.
3. La app del jugador (con la URL nueva) trae canchas.
4. Apagás tu PC y **todo sigue funcionando**. Ese es el objetivo cumplido.

---

## Costos (realista)

- Railway: plan gratis con límite de horas/uso; cuando crezca, ~USD 5–10/mes.
- Vercel: gratis para esto.
- Base: incluida en Railway al principio.

Para el piloto gratis alcanza el plan free. Cuando tengas clubes pagando,
migrás a un plan pago (que igual es barato al principio).

---

## Si algo falla

- **El backend no arranca:** mirá los **Logs** en Railway. Casi siempre es una
  variable de entorno faltante o mal escrita.
- **El panel no carga datos:** es CORS. Verificá que `CORS_ORIGINS` en Railway
  tenga EXACTA la URL de Vercel (con https, sin barra al final).
- **Error de base:** verificá que la Parte 2 (setup) haya corrido completa,
  incluido el RLS.
