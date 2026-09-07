# ClubOS — Frontend

## Archivos

```
login.html       Entrada. Detecta si hay backend y avisa si no.
agenda.html      Pantalla de agenda. Funciona sola (datos de demo) o
                 contra el backend real.
landing.html     Landing comercial. Gráficos SVG propios, sin dependencias.
src/lib/         grid.ts       geometría de la grilla temporal
                 api.ts        cliente de la API
                 agenda-store.ts  estado con optimismo y reversión
```

## Probar sin backend

Abrí `agenda.html` en el navegador. Detecta que no hay API, usa datos de
ejemplo y lo avisa con un cartel "Datos de ejemplo" en la barra superior.

Una pantalla que finge estar conectada es peor que una que avisa que no lo
está: si el operador cree que guardó un turno y no se guardó, el problema
aparece cuando el cliente llega.

## Conectar al backend

```js
// antes de cargar agenda.html, o editando la constante:
window.CLUBOS_API = 'http://localhost:3000/api/v1';
```

Al arrancar llama a `GET /agenda/day`. Si responde, usa datos reales y el
cartel de demo desaparece.

## Verificación

```bash
npm run verify      # 68 tests: geometría, estado, mapeo de la API
npm run typecheck
```

## Decisiones que conviene no revertir sin pensarlo

**El token va en sessionStorage, no en localStorage.** localStorage sobrevive
al cierre del navegador; sessionStorage muere con la pestaña. En una recepción
con computadora compartida, que la sesión no persista es lo correcto. El
refresh viaja en cookie httpOnly que el JS no puede leer.

**Una sola renovación de token en vuelo.** Si diez requests expiran juntas y
cada una pide un refresh, la detección de reuso del backend lo interpreta como
un token robado y cierra todas las sesiones del usuario.

**El login nunca dice cuál campo falló.** "Email o contraseña incorrectos"
para las dos cosas. Distinguirlos permite averiguar qué emails están
registrados en el sistema.

**Los botones se ocultan según el rol.** Un botón que siempre falla con "sin
permiso" enseña al operador a ignorar los mensajes de error.

**Mover un turno es optimista; cobrar y cancelar no.** Arrastrar y esperar
300ms a que el bloque salte se siente roto, y el estado previo de un
movimiento es recuperable exactamente. En cambio el neto de un cobro depende
de la comisión del medio de pago y la devolución de una cancelación depende
del tramo de antelación: los calcula el servidor, y mostrar un número para
corregirlo después es peor que esperar.

**Reprogramar recarga la agenda entera.** El backend no edita la reserva: la
cancela y crea una nueva encadenada, para conservar el historial. Si el front
actualizara el bloque en su lugar, quedaría apuntando a un id que en el
servidor ya está en `RESCHEDULED`.

**La validación local de solapamiento no es la verdad.** Sirve para evitar un
viaje al servidor por lo obvio y dar un mensaje mejor. La garantía real es el
`EXCLUDE` constraint de Postgres: si entre el arrastre y la confirmación otro
operador tomó el horario, el servidor responde 409 y la pantalla revierte.

**La búsqueda tiene debounce y número de secuencia.** Recepción escribe
mientras habla por teléfono: sin debounce "gonzalez" son ocho requests, y sin
secuencia la respuesta de "gonz" puede pisar la de "gonzalez".

**Refresca al volver a la pestaña.** Mirar una agenda de hace veinte minutos
es exactamente cómo se cargan turnos duplicados.
