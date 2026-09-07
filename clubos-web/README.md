# ClubOS-web — prototipos estáticos (obsoleto)

Estos tres `.html` son la etapa anterior del panel del club, previa a
`clubos-next` (Next.js), que es hoy **la única implementación real y
mantenida** del frontend. Se conservan acá como referencia visual/histórica,
no como un proyecto activo.

```
landing.html      Landing comercial (SVG propios, sin dependencias).
login.html        Pantalla de login del prototipo.
agenda.html       Agenda del prototipo, con datos de ejemplo embebidos.
```

Abrí cualquiera directamente en el navegador (`file://...`) — no hay build,
no hay `npm install`, no hay tests. Las decisiones de diseño documentadas acá
antes (sessionStorage vs localStorage, una sola renovación de token en
vuelo, reprogramar recarga la agenda entera, etc.) **ya están implementadas
en el producto real** — ver `clubos-next/src/lib/` y `clubos-next/README.md`,
y el backend en `clubos/src/auth/`, `clubos/src/bookings/`.

No hay `src/lib/`, ni `verify-*`, ni tests en este directorio pese a lo que
decía una versión anterior de este README — esa lógica se migró a
`clubos-next` (que sí tiene `verify-grid.cjs`/`verify-store.cjs` reales,
corribles con `npm run verify` desde `clubos-next/`).
