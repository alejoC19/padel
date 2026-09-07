# 🎾 ClubOS — Cómo arrancar (guía corta)

Esta versión ya trae **todos los arreglos** que fuimos encontrando. Seguí estos
pasos tal cual, con **Git Bash** (la terminal de Git en VS Code).

> **Requisito único:** tener **Docker Desktop ABIERTO** antes de empezar.
> (Node ya lo tenés.)

---

## Paso 1 — Backend

Abrí una terminal Git Bash y corré:

```bash
cd clubos
bash start.sh
```

El script hace TODO solo (base de datos, dependencias, tablas, datos de prueba)
y detecta si tenés otro Postgres ocupando el puerto. Tarda unos minutos la
primera vez. Cuando termine, verás `✅ Backend listo`.

Ahí arrancá la API (en la misma terminal):

```bash
npm run start:dev
```

Esperá a que diga: **`ClubOS API escuchando en :3000`**

Comprobá en el navegador: <http://localhost:3000/health>
→ tenés que ver `{"status":"ok",...}`

**Dejá esta terminal abierta.**

---

## Paso 2 — Frontend

Abrí una **segunda** terminal Git Bash (con el `+` del panel de terminal):

```bash
cd clubos-next
bash start.sh
```

Cuando termine, arrancá el front:

```bash
npm run dev
```

Esperá a que diga que está en `http://localhost:3001`.

**Dejá esta terminal abierta también.**

---

## Paso 3 — Ver funcionar

Abrí en el navegador:

### <http://localhost:3001/crear-club>

Completá el wizard de 3 pasos. Al terminar, crea tu club y te lleva a la agenda.

También podés entrar con el **club demo** que ya viene sembrado:
<http://localhost:3001/entrar>
- Email: `owner@clubdemo.com.ar`
- Contraseña: `Demo1234!`

---

## Si algo falla

**"página caída" / no carga:** casi siempre es que una de las dos terminales se
cerró o Docker se bajó. Revisá que:
1. Docker Desktop esté abierto.
2. La terminal del backend diga "escuchando en :3000" (no otro número).
3. La terminal del front esté corriendo.

**Reiniciar la base** (si Docker se bajó): en `clubos/`, `docker compose up -d db redis`.

**Empezar de cero limpio:** en `clubos/`:
```bash
docker compose down -v      # borra la base
rm -rf node_modules .env    # borra deps y config
bash start.sh               # vuelve a armar todo
```

---

## Qué NO funciona todavía (y está bien)

- **Pagos con Mercado Pago**: necesitan credenciales reales (una cuenta de MP).
- **WhatsApp / email**: necesitan cuentas de Meta / Resend.

Todo lo demás — crear club, login, agenda, reservas, caja, clientes — funciona
localmente sin configurar nada de eso.
