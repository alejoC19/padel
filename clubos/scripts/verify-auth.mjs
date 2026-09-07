/**
 * Verificación del login y el manejo de sesión.
 *
 * Simula el backend para probar los caminos que importan: credenciales
 * incorrectas, varios clubes, expiración de token y renovación concurrente.
 */
import fs from 'fs';

const login = fs.readFileSync('/home/claude/clubos-web/login.html', 'utf8');
const agenda = fs.readFileSync('/home/claude/clubos-web/agenda.html', 'utf8');

let pass = 0, fail = 0;
const check = async (n, f) => {
  try { await f(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${a}, want ${b}`); };

// ---------------------------------------------------------------------------
// Backend simulado
// ---------------------------------------------------------------------------
function makeBackend(opts = {}) {
  const users = opts.users ?? {
    'ana@club.com.ar': {
      password: 'Correcta123',
      firstName: 'Ana', lastName: 'Ruiz',
      clubs: [{ id: 'club-1', name: 'Club Norte', slug: 'norte', roleCode: 'RECEPTION', status: 'ACTIVE' }],
      permissions: ['booking.view', 'booking.create', 'payment.create'],
    },
    'multi@club.com.ar': {
      password: 'Correcta123',
      firstName: 'Multi', lastName: 'Club',
      clubs: [
        { id: 'club-1', name: 'Club Norte', slug: 'norte', roleCode: 'OWNER', status: 'ACTIVE' },
        { id: 'club-2', name: 'Club Sur', slug: 'sur', roleCode: 'ADMIN', status: 'PAST_DUE' },
      ],
      permissions: ['booking.view'],
    },
    'huerfano@club.com.ar': {
      password: 'Correcta123',
      firstName: 'Sin', lastName: 'Club',
      clubs: [], permissions: [],
    },
  };

  const state = { attempts: 0, refreshCount: 0, tokenValid: true };

  return {
    state,
    async login(email, password, clubId) {
      state.attempts++;
      if (opts.rateLimitAfter && state.attempts > opts.rateLimitAfter) {
        const e = new Error('Demasiados intentos'); e.status = 429; throw e;
      }
      const u = users[email];
      // Mismo error para email inexistente y contraseña mala.
      if (!u || u.password !== password) {
        const e = new Error('Email o contraseña incorrectos'); e.status = 401; throw e;
      }
      let active = null;
      if (clubId) {
        active = u.clubs.find(c => c.id === clubId);
        if (!active) { const e = new Error('No tenés acceso a este club'); e.status = 403; throw e; }
      } else if (u.clubs.length === 1) {
        active = u.clubs[0];
      }
      return {
        accessToken: `tok-${email}-${active?.id ?? 'none'}`,
        activeClub: active,
        clubs: u.clubs,
        permissions: u.permissions,
        user: { id: 'u1', firstName: u.firstName, lastName: u.lastName },
      };
    },
    async refresh() {
      state.refreshCount++;
      if (!opts.refreshWorks) { const e = new Error('Sesión inválida'); e.status = 401; throw e; }
      state.tokenValid = true;
      return { accessToken: 'tok-renovado' };
    },
  };
}

// ---------------------------------------------------------------------------
console.log('\nCredenciales\n');
// ---------------------------------------------------------------------------

await check('email y contraseña correctos entran directo', async () => {
  const be = makeBackend();
  const res = await be.login('ana@club.com.ar', 'Correcta123');
  eq(res.activeClub.id, 'club-1', 'club único se autoselecciona');
  eq(res.permissions.length, 3, 'trae los permisos');
});

await check('contraseña incorrecta da 401', async () => {
  const be = makeBackend();
  try { await be.login('ana@club.com.ar', 'Mala'); throw new Error('debería fallar'); }
  catch (e) { eq(e.status, 401, 'código'); }
});

await check('email inexistente da el MISMO error que contraseña mala', async () => {
  const be = makeBackend();
  let e1, e2;
  try { await be.login('noexiste@club.com.ar', 'X'); } catch (e) { e1 = e; }
  try { await be.login('ana@club.com.ar', 'Mala'); } catch (e) { e2 = e; }
  eq(e1.message, e2.message, 'los mensajes deben ser idénticos');
  eq(e1.status, e2.status, 'y el código también');
  // Distinguirlos permite averiguar qué emails están registrados.
});

await check('el front no revela cuál campo falló', () => {
  const handler = login.slice(login.indexOf('function handleLoginError'), login.indexOf('// ---', login.indexOf('function handleLoginError')));
  if (handler.includes('no existe') || handler.includes('no encontrado'))
    throw new Error('el mensaje delata que el email no existe');
  if (!handler.includes('Email o contraseña incorrectos'))
    throw new Error('falta el mensaje genérico');
});

await check('demasiados intentos da 429 con mensaje propio', async () => {
  const be = makeBackend({ rateLimitAfter: 3 });
  for (let i = 0; i < 3; i++) {
    try { await be.login('ana@club.com.ar', 'Mala'); } catch {}
  }
  try { await be.login('ana@club.com.ar', 'Correcta123'); throw new Error('debería limitar'); }
  catch (e) { eq(e.status, 429, 'rate limit'); }
  const handler = login.slice(login.indexOf('function handleLoginError'));
  if (!handler.includes('429')) throw new Error('el front no maneja el 429');
});

// ---------------------------------------------------------------------------
console.log('\nUsuarios con varios clubes\n');
// ---------------------------------------------------------------------------

await check('con dos clubes no autoselecciona ninguno', async () => {
  const be = makeBackend();
  const res = await be.login('multi@club.com.ar', 'Correcta123');
  eq(res.activeClub, null, 'debe pedir que elija');
  eq(res.clubs.length, 2, 'y ofrecer los dos');
});

await check('elegir un club devuelve token para ESE club', async () => {
  const be = makeBackend();
  const res = await be.login('multi@club.com.ar', 'Correcta123', 'club-2');
  eq(res.activeClub.id, 'club-2', 'club elegido');
  if (!res.accessToken.includes('club-2')) throw new Error('el token debe ser del club correcto');
});

await check('elegir un club sin acceso da 403', async () => {
  const be = makeBackend();
  try { await be.login('ana@club.com.ar', 'Correcta123', 'club-9'); throw new Error('debería fallar'); }
  catch (e) { eq(e.status, 403, 'sin acceso'); }
});

await check('un club con pago pendiente se marca en la lista', () => {
  if (!login.includes("c.status === 'PAST_DUE'")) throw new Error('no marca el club moroso');
  if (!login.includes('Pago pendiente')) throw new Error('falta el aviso');
});

await check('cuenta sin clubes recibe una explicación útil', async () => {
  const be = makeBackend();
  const res = await be.login('huerfano@club.com.ar', 'Correcta123');
  eq(res.clubs.length, 0, 'sin clubes');
  if (!login.includes('no tiene ningún club asignado'))
    throw new Error('falta el mensaje para cuentas sin club');
  if (!login.includes('que te invite'))
    throw new Error('debe decir qué hacer, no solo que falló');
});

// ---------------------------------------------------------------------------
console.log('\nSesión\n');
// ---------------------------------------------------------------------------

await check('usa sessionStorage, NO localStorage', () => {
  if (login.includes('localStorage.setItem'))
    throw new Error('localStorage sobrevive al cierre: en una recepción compartida es un riesgo');
  if (!login.includes("sessionStorage.setItem('clubos.token'"))
    throw new Error('falta guardar el token');
  if (agenda.includes("localStorage.getItem('clubos.token')"))
    throw new Error('la agenda no debe leer de localStorage');
});

await check('la agenda manda el club activo en cada request', () => {
  if (!agenda.includes("headers['x-club-id'] = activeClubId"))
    throw new Error('falta el header de club');
});

await check('un 401 intenta renovar antes de expulsar', () => {
  const fn = agenda.slice(agenda.indexOf('async function apiCall'), agenda.indexOf('async function fetchDay'));
  if (!fn.includes('res.status === 401 && retry')) throw new Error('no maneja el 401');
  if (!fn.includes('await refreshToken()')) throw new Error('no intenta renovar');
  if (fn.indexOf('endSession()') < fn.indexOf('refreshToken()'))
    throw new Error('expulsa antes de intentar renovar');
});

await check('el reintento no entra en bucle infinito', () => {
  const fn = agenda.slice(agenda.indexOf('async function apiCall'), agenda.indexOf('async function fetchDay'));
  if (!fn.includes('apiCall(path, init, false)'))
    throw new Error('el reintento debe desactivar el retry');
});

await check('una sola renovación en vuelo, compartida', async () => {
  // Simula diez requests que expiran juntas.
  let inFlight = null, calls = 0;
  const refresh = async () => {
    if (inFlight) return inFlight;
    inFlight = (async () => { calls++; await new Promise(r => setTimeout(r, 10)); return true; })();
    const r = await inFlight;
    queueMicrotask(() => { inFlight = null; });
    return r;
  };
  await Promise.all(Array.from({ length: 10 }, () => refresh()));
  eq(calls, 1, 'diez requests deben compartir una sola renovación');
  // Sin esto, el backend detecta reuso de refresh token y cierra TODAS
  // las sesiones del usuario.
  if (!agenda.includes('refreshInFlight')) throw new Error('falta la renovación compartida');
});

await check('si la renovación falla, se cierra la sesión', () => {
  const fn = agenda.slice(agenda.indexOf('async function apiCall'), agenda.indexOf('async function fetchDay'));
  if (!fn.includes('if (renewed) return apiCall')) throw new Error('falta el reintento tras renovar');
  if (!fn.includes('endSession()')) throw new Error('no cierra sesión cuando no puede renovar');
});

await check('cerrar sesión limpia todo y vuelve al login', () => {
  if (!agenda.includes('sessionStorage.clear()')) throw new Error('no limpia la sesión');
  if (!agenda.includes("location.href = 'login.html'")) throw new Error('no redirige al login');
});

// ---------------------------------------------------------------------------
console.log('\nPermisos en la interfaz\n');
// ---------------------------------------------------------------------------

await check('los botones se ocultan según el rol', () => {
  if (!agenda.includes("can('payment.create')")) throw new Error('cobrar sin chequeo de permiso');
  if (!agenda.includes("can('booking.cancel')")) throw new Error('cancelar sin chequeo');
  if (!agenda.includes("can('booking.checkin')")) throw new Error('check-in sin chequeo');
});

await check('sin permisos se explica en vez de mostrar un panel vacío', () => {
  if (!agenda.includes('Sin acciones disponibles para tu rol'))
    throw new Error('falta el mensaje para roles limitados');
});

await check('en modo demo se muestran todas las acciones', () => {
  const fn = agenda.slice(agenda.indexOf('function can('), agenda.indexOf('function endSession'));
  if (!fn.includes('!LIVE ||')) throw new Error('el modo demo debe permitir todo');
});

// ---------------------------------------------------------------------------
console.log('\nDetalles de uso\n');
// ---------------------------------------------------------------------------

await check('Enter envía el formulario desde cualquier campo', () => {
  if (!login.includes("e.key === 'Enter'")) throw new Error('falta el atajo');
  // Recepción tipea rápido y no usa el mouse.
});

await check('el botón se bloquea mientras entra', () => {
  const fn = login.slice(login.indexOf('function setLoading'), login.indexOf('// ---', login.indexOf('function setLoading')));
  if (!fn.includes('submitBtn.disabled = on')) throw new Error('permite doble envío');
  if (!fn.includes('spinner')) throw new Error('no indica que está trabajando');
});

await check('se puede ver la contraseña escrita', () => {
  if (!login.includes('pwToggle')) throw new Error('falta el botón de mostrar');
  if (!login.includes("aria-pressed")) throw new Error('el toggle no es accesible');
});

await check('avisa si no hay backend antes de que escriba', () => {
  if (!login.includes('async function checkBackend')) throw new Error('no chequea el backend');
  if (!login.includes('demoNote')) throw new Error('falta el aviso');
  if (!login.includes('agenda.html')) throw new Error('debe ofrecer la agenda de ejemplo');
});

await check('si ya hay sesión activa no pide login de nuevo', () => {
  const fn = login.slice(login.indexOf('async function checkBackend'), login.indexOf('// ---', login.indexOf('async function checkBackend')));
  if (!fn.includes("location.href = 'agenda.html'"))
    throw new Error('debería saltar directo a la agenda');
});

await check('el nombre del club se escapa antes de insertarlo', () => {
  if (!login.includes('escapeHtml(c.name)'))
    throw new Error('el nombre del club va al DOM sin escapar: riesgo de XSS');
});

console.log(`\n${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail ? 1 : 0);
