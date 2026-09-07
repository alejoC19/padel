/**
 * Verificación de la lógica de rotación con una BD en memoria.
 * No es el test suite definitivo: valida el algoritmo antes de tener
 * Postgres disponible.
 */
const { createHash, randomBytes, randomUUID } = require('node:crypto');

// --- Fake DB ---
const db = { sessions: new Map(), users: new Map(), memberships: [] };
const hash = (t) => createHash('sha256').update(t).digest('hex');
const gen = () => randomBytes(32).toString('base64url');

class FakeTokenService {
  constructor() { this.revokeAllCalls = 0; }

  issue(userId, clubId) {
    const sid = randomUUID();
    const rt = gen();
    db.sessions.set(sid, {
      id: sid, userId, activeClubId: clubId,
      refreshTokenHash: hash(rt),
      expiresAt: new Date(Date.now() + 30 * 86400000),
      revokedAt: null, replacedById: null,
    });
    return { sid, refreshToken: rt };
  }

  findByToken(rt) {
    const h = hash(rt);
    for (const s of db.sessions.values()) {
      if (s.refreshTokenHash === h) return s;
    }
    return null;
  }

  rotate(rt, overrideClubId) {
    const session = this.findByToken(rt);
    if (!session) throw new Error('SESSION_INVALID');

    if (session.revokedAt || session.replacedById) {
      this.revokeAllForUser(session.userId);
      throw new Error('REUSE_DETECTED');
    }
    if (session.expiresAt < new Date()) throw new Error('EXPIRED');

    const clubId = overrideClubId !== undefined ? overrideClubId : session.activeClubId;
    if (clubId) {
      const ok = db.memberships.some(
        (m) => m.clubId === clubId && m.userId === session.userId && m.status === 'ACTIVE'
      );
      if (!ok) throw new Error('NO_CLUB_ACCESS');
    }

    const newSid = randomUUID();
    const newRt = gen();
    db.sessions.set(newSid, {
      id: newSid, userId: session.userId, activeClubId: clubId,
      refreshTokenHash: hash(newRt),
      expiresAt: new Date(Date.now() + 30 * 86400000),
      revokedAt: null, replacedById: null,
    });
    session.revokedAt = new Date();
    session.replacedById = newSid;

    return { refreshToken: newRt, sid: newSid, clubId };
  }

  revokeAllForUser(userId) {
    this.revokeAllCalls++;
    for (const s of db.sessions.values()) {
      if (s.userId === userId && !s.revokedAt) s.revokedAt = new Date();
    }
  }
}

// --- Tests ---
let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`); }
function throws(fn, code) {
  try { fn(); } catch (e) { if (e.message !== code) throw new Error(`esperaba ${code}, vino ${e.message}`); return; }
  throw new Error(`esperaba throw ${code}, no lanzó`);
}

const CLUB_A = randomUUID(), CLUB_B = randomUUID(), USER = randomUUID();
db.memberships.push(
  { clubId: CLUB_A, userId: USER, status: 'ACTIVE' },
  { clubId: CLUB_B, userId: USER, status: 'ACTIVE' },
);

console.log('\nRotación de refresh tokens\n');

check('el token rotado cambia', () => {
  const svc = new FakeTokenService();
  const { refreshToken: rt1 } = svc.issue(USER, CLUB_A);
  const { refreshToken: rt2 } = svc.rotate(rt1);
  if (rt1 === rt2) throw new Error('el token no cambió');
});

check('el token viejo queda revocado y encadenado', () => {
  const svc = new FakeTokenService();
  const { refreshToken: rt1, sid } = svc.issue(USER, CLUB_A);
  const { sid: sid2 } = svc.rotate(rt1);
  const old = db.sessions.get(sid);
  if (!old.revokedAt) throw new Error('no se revocó');
  eq(old.replacedById, sid2, 'cadena rota');
});

check('reusar un token rotado lanza REUSE_DETECTED', () => {
  const svc = new FakeTokenService();
  const { refreshToken: rt1 } = svc.issue(USER, CLUB_A);
  svc.rotate(rt1);
  throws(() => svc.rotate(rt1), 'REUSE_DETECTED');
});

check('el reuso revoca TODAS las sesiones del usuario', () => {
  db.sessions.clear();
  const svc = new FakeTokenService();
  const { refreshToken: rt1 } = svc.issue(USER, CLUB_A);
  svc.issue(USER, CLUB_B);
  svc.issue(USER, CLUB_A);
  const { refreshToken: rt2 } = svc.rotate(rt1);
  throws(() => svc.rotate(rt1), 'REUSE_DETECTED');
  const alive = [...db.sessions.values()].filter((s) => s.userId === USER && !s.revokedAt);
  eq(alive.length, 0, 'quedaron sesiones vivas tras el reuso');
  throws(() => svc.rotate(rt2), 'REUSE_DETECTED');
});

check('el reuso NO afecta a otros usuarios', () => {
  db.sessions.clear();
  const other = randomUUID();
  const svc = new FakeTokenService();
  const { refreshToken: rtA } = svc.issue(USER, CLUB_A);
  const { refreshToken: rtB } = svc.issue(other, CLUB_A);
  svc.rotate(rtA);
  throws(() => svc.rotate(rtA), 'REUSE_DETECTED');
  const s = svc.findByToken(rtB);
  if (s.revokedAt) throw new Error('se revocó la sesión de otro usuario');
});

check('token expirado se rechaza', () => {
  db.sessions.clear();
  const svc = new FakeTokenService();
  const { refreshToken, sid } = svc.issue(USER, CLUB_A);
  db.sessions.get(sid).expiresAt = new Date(Date.now() - 1000);
  throws(() => svc.rotate(refreshToken), 'EXPIRED');
});

check('token inexistente se rechaza', () => {
  const svc = new FakeTokenService();
  throws(() => svc.rotate(gen()), 'SESSION_INVALID');
});

check('el token se guarda hasheado, nunca en claro', () => {
  db.sessions.clear();
  const svc = new FakeTokenService();
  const { refreshToken } = svc.issue(USER, CLUB_A);
  for (const s of db.sessions.values()) {
    if (s.refreshTokenHash === refreshToken) throw new Error('token en claro en la BD');
    eq(s.refreshTokenHash.length, 64, 'no parece SHA-256');
  }
});

console.log('\nCambio de club\n');

check('switch a club permitido funciona', () => {
  db.sessions.clear();
  const svc = new FakeTokenService();
  const { refreshToken } = svc.issue(USER, CLUB_A);
  const r = svc.rotate(refreshToken, CLUB_B);
  eq(r.clubId, CLUB_B, 'no cambió el club');
});

check('switch a club sin membresía se rechaza', () => {
  db.sessions.clear();
  const svc = new FakeTokenService();
  const { refreshToken } = svc.issue(USER, CLUB_A);
  throws(() => svc.rotate(refreshToken, randomUUID()), 'NO_CLUB_ACCESS');
});

check('membresía revocada corta el acceso en el refresh', () => {
  db.sessions.clear();
  const svc = new FakeTokenService();
  const { refreshToken } = svc.issue(USER, CLUB_B);
  const m = db.memberships.find((x) => x.clubId === CLUB_B);
  m.status = 'REVOKED';
  throws(() => svc.rotate(refreshToken, CLUB_B), 'NO_CLUB_ACCESS');
  m.status = 'ACTIVE';
});

check('refresh sin club activo no valida membresía', () => {
  db.sessions.clear();
  const svc = new FakeTokenService();
  const { refreshToken } = svc.issue(USER, null);
  const r = svc.rotate(refreshToken);
  eq(r.clubId, null, 'debería seguir sin club');
});

console.log(`\n${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail ? 1 : 0);
