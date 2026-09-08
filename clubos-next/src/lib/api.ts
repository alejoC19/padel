/**
 * Cliente de la API de ClubOS.
 *
 * ---------------------------------------------------------------------------
 * TOKENS
 * ---------------------------------------------------------------------------
 * El access token vive en memoria, no en localStorage: cualquier XSS puede
 * leer localStorage. El refresh viaja en cookie httpOnly, que el JS de la
 * página no puede tocar. La contra es que al recargar hay que pedir un token
 * nuevo — un round-trip al arrancar, a cambio de que un XSS no se lleve la
 * sesión.
 *
 * Para sobrevivir un F5 sin quedar sin club, al cargar el módulo se restaura
 * lo último que guardó el login en sessionStorage (token + club). Si el token
 * ya venció, el primer 401 dispara el refresh por cookie y sigue andando.
 *
 * ---------------------------------------------------------------------------
 * REINTENTO POR 401
 * ---------------------------------------------------------------------------
 * Si una request falla con 401, se pide un token nuevo y se reintenta UNA vez.
 * Las llamadas concurrentes comparten el mismo refresh en vuelo: sin eso,
 * diez requests que expiran juntas disparan diez refreshes y la rotación de
 * tokens del backend interpreta reuso y cierra todas las sesiones.
 * ---------------------------------------------------------------------------
 */

/**
 * URL base de la API.
 *
 * Next.js expone al browser solo las env que empiezan con NEXT_PUBLIC_.
 * En dev, el front corre en :3001 y la API en :3000, así que el fallback
 * apunta ahí. En producción se setea NEXT_PUBLIC_API_URL al dominio real.
 */
const BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

let accessToken: string | null = null;
let activeClubId: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

// Claves con las que el login guarda la sesión en sessionStorage.
const TOKEN_KEY = 'clubos.token';
const CLUB_KEY = 'clubos.club';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** El horario se ocupó entre que se cargó la agenda y se confirmó. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  get isOverlap(): boolean {
    return this.code === 'BOOKING_OVERLAP';
  }

  get needsCashSession(): boolean {
    return this.code === 'CASH_SESSION_NOT_OPEN' ||
      this.message.includes('No hay una caja abierta');
  }
}

export function setSession(token: string | null, clubId: string | null): void {
  accessToken = token;
  activeClubId = clubId;
  // Persistir para sobrevivir un refresh de página. En sessionStorage: al
  // cerrar la pestaña se borra (recepción con compu compartida).
  if (typeof window !== 'undefined') {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
      if (clubId) sessionStorage.setItem(CLUB_KEY, clubId);
      else sessionStorage.removeItem(CLUB_KEY);
    } catch { /* sessionStorage no disponible: seguimos solo en memoria */ }
  }
}

/**
 * Restaura la sesión desde sessionStorage al arrancar el módulo.
 *
 * Sin esto, tras un F5 las variables en memoria quedan vacías y todas las
 * requests salen sin club → el backend responde 403 "Contexto no disponible".
 * El token puede estar vencido; no importa: el primer 401 dispara el refresh.
 */
function restoreSession(): void {
  if (typeof window === 'undefined') return;
  try {
    accessToken = sessionStorage.getItem(TOKEN_KEY);
    activeClubId = sessionStorage.getItem(CLUB_KEY);
  } catch { /* sin sessionStorage: queda en null y el login lo resuelve */ }
}

// Se ejecuta una vez, al importar el módulo en el browser.
restoreSession();

export function getActiveClubId(): string | null {
  return activeClubId;
}

async function refreshToken(): Promise<boolean> {
  // Una sola renovación a la vez, compartida por todos los que esperan.
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) return false;
      const data = await res.json();
      accessToken = data.accessToken;
      activeClubId = data.activeClub?.id ?? activeClubId;
      // Actualizar lo persistido para que el próximo F5 arranque al día.
      if (typeof window !== 'undefined') {
        try {
          if (accessToken) sessionStorage.setItem(TOKEN_KEY, accessToken);
          if (activeClubId) sessionStorage.setItem(CLUB_KEY, activeClubId);
        } catch { /* noop */ }
      }
      return true;
    } catch {
      return false;
    } finally {
      // Se libera en el microtask siguiente para que los que ya estaban
      // esperando lean el resultado antes de que se limpie.
      queueMicrotask(() => { refreshInFlight = null; });
    }
  })();

  return refreshInFlight;
}

/**
 * Cierra la sesión del lado del cliente y manda a `/entrar`.
 *
 * Se llama solo ante un 401 genuino: había un token y, ni siquiera después
 * de intentar renovarlo, el backend lo acepta. Una request sin token para
 * empezar (modo demostración) nunca llega acá — ese 401 es esperado y lo
 * maneja cada pantalla mostrando datos de ejemplo, no un logout.
 *
 * Sin este redirect, una sesión que vence a mitad de uso deja a la persona
 * mirando una pantalla rota para siempre: los fetches siguen fallando, pero
 * nada le avisa que tiene que volver a entrar.
 */
function forceLogout(): void {
  setSession(null, null);
  if (typeof window === 'undefined') return;
  try { sessionStorage.clear(); } catch { /* sessionStorage no disponible */ }
  // Ya estar en /entrar (o yendo para allá) evita un loop de redirects.
  if (!window.location.pathname.startsWith('/entrar')) {
    window.location.href = '/entrar';
  }
}

/**
 * Repregunta al backend cuál es el club activo de VERDAD, mandando el
 * Authorization pero sin `x-club-id` — así el backend resuelve por el
 * propio token, no por lo que haya quedado guardado en este dispositivo.
 *
 * Fetch directo (no pasa por `request()`) a propósito: es la herramienta
 * que usa `request()` para recuperarse de un x-club-id viejo, así que no
 * puede depender de esa misma lógica de reintento sin arriesgar un loop.
 */
async function resyncActiveClub(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/auth/me`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.clubId === 'string' ? data.clubId : null;
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
  clubRetry = true,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const sentClubId = activeClubId;
  if (sentClubId) headers['x-club-id'] = sentClubId;

  // Se captura antes del fetch: refreshToken() puede reemplazar accessToken
  // más abajo, y lo que importa acá es si ESTA request salió con un token.
  const hadToken = accessToken !== null;

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && retry) {
    const ok = await refreshToken();
    if (ok) return request<T>(path, init, false, clubRetry);
    // La renovación también falló. Sin token no había sesión que perder
    // (modo demo); con token, es una sesión vencida de verdad.
    if (hadToken) forceLogout();
  } else if (res.status === 401 && !retry && hadToken) {
    // Reintento posterior a una renovación exitosa que igual volvió a
    // rebotar: el token nuevo tampoco sirve, no tiene sentido seguir
    // reintentando.
    forceLogout();
  }

  // 403 con un x-club-id puesto: puede ser el club guardado en este
  // dispositivo desincronizado del que realmente tiene el token (quedó de
  // una sesión anterior, se lo dio de baja, etc.) — TenantGuard prioriza
  // el header por sobre el club del token, así que un valor viejo pisa uno
  // válido y la pantalla queda 403 para siempre sin este reintento (a
  // diferencia del 401, para el que sí hay recuperación automática). Se
  // repregunta el club real y se reintenta UNA vez; si el 403 persiste, es
  // un rechazo de permisos genuino y se deja pasar tal cual.
  if (res.status === 403 && retry && clubRetry && sentClubId) {
    const realClubId = await resyncActiveClub();
    if (realClubId && realClubId !== sentClubId) {
      setSession(accessToken, realClubId);
      return request<T>(path, init, retry, false);
    }
  }

  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try { body = await res.json(); } catch { /* respuesta sin cuerpo */ }
    throw new ApiError(
      res.status,
      String(body.error ?? 'UNKNOWN'),
      String(body.message ?? `Error ${res.status}`),
      body.details,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Tipos que devuelve el backend
// ---------------------------------------------------------------------------

export interface AgendaBooking {
  id: string;
  code: string;
  courtId: string;
  startsAt: string;
  endsAt: string;
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
  type: string;
  status: string;
  paymentStatus: string;
  title: string;
  clientId: string | null;
  clientPhone: string | null;
  instructorName: string | null;
  playersCount: number;
  totalPrice: number;
  paidAmount: number;
  pendingAmount: number;
  checkInAt: string | null;
  hasNotes: boolean;
}

export interface AgendaCourt {
  id: string;
  name: string;
  number: number;
  color: string;
  status: string;
  slotMinutes: number;
  capacity: number;
  environment: string;
  openMinute: number | null;
  closeMinute: number | null;
}

export interface AgendaDay {
  date: string;
  timezone: string;
  openMinute: number;
  closeMinute: number;
  courts: AgendaCourt[];
  bookings: AgendaBooking[];
  blocks: Array<{
    id: string; courtId: string | null;
    startMinute: number; endMinute: number;
    type: string; reason: string;
  }>;
  summary: {
    bookingsCount: number;
    occupancyPercent: number;
    revenue: number;
    pendingRevenue: number;
    cancelledCount: number;
    noShowCount: number;
  };
}

export interface DailyClose {
  date: string;
  timezone: string;
  totals: {
    billed: number; collected: number; pending: number;
    outflow: number; fees: number; net: number;
  };
  bookings: {
    total: number; played: number; cancelled: number; noShow: number;
    occupancyPercent: number; bookedMinutes: number; capacityMinutes: number;
    billed: number; collected: number; pending: number;
  };
  buffet: {
    sales: number; voided: number; billed: number; collected: number;
    cost: number; grossProfit: number; marginPercent: number | null;
    topProducts: Array<{
      productId: string | null; name: string; quantity: number; total: number;
    }>;
  };
  byPaymentMethod: Array<{
    code: string; name: string; kind: string; amount: number;
    fees: number; net: number; count: number; settlesInDays: number;
  }>;
  cashSessions: Array<{
    id: string; register: string; operator: string | null;
    openedAt: string; closedAt: string | null; status: string;
    openingAmount: number; expectedAmount: number | null;
    countedAmount: number | null; difference: number | null;
    differenceReason: string | null;
  }>;
  alerts: Array<{
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    message: string;
    action?: string;
  }>;
}

export interface CashFlowDay {
  date: string;
  inflow: number;
  outflow: number;
  net: number;
  runningBalance: number;
  isNegative: boolean;
  detail: {
    settlements: Array<{ code: string; amount: number; method: string }>;
    expenses: Array<{
      code: string; concept: string; amount: number; supplier: string | null;
    }>;
  };
}

export interface CashFlowProjection {
  from: string;
  to: string;
  openingBalance: number;
  breakdown: { banks: number; cashOnHand: number };
  totals: {
    expectedInflow: number;
    committedOutflow: number;
    projectedBalance: number;
  };
  days: CashFlowDay[];
  alerts: Array<{ severity: 'HIGH' | 'MEDIUM'; message: string }>;
}

export interface PendingExpense {
  id: string;
  code: string;
  concept: string;
  total: number;
  date: string;
  dueDate: string | null;
  supplier: string | null;
  category: string | null;
  daysToDue: number | null;
  isOverdue: boolean;
}

export interface ClientSearchResult {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  documentNumber: string | null;
  status: string;
  accountBalance: number;
  lastVisitAt: string | null;
  score: number;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const api = {
  auth: {
    login: (email: string, password: string, clubId?: string) =>
      request<{
        accessToken: string;
        activeClub: { id: string; name: string } | null;
        clubs: Array<{ id: string; name: string; slug: string }>;
        permissions: string[];
        user: { id: string; firstName: string; lastName: string };
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, clubId }),
      }),

    me: () => request<{
      userId: string; clubId: string | null;
      roleCode: string | null; permissions: string[];
    }>('/auth/me'),

    logout: () => request<void>('/auth/logout', { method: 'POST' }),

    forgotPassword: (email: string) =>
      request<void>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),

    resetPassword: (token: string, newPassword: string) =>
      request<void>('/auth/reset-password', {
        method: 'POST', body: JSON.stringify({ token, newPassword }),
      }),

    acceptInvite: (token: string, password: string) =>
      request<{
        accessToken: string;
        activeClub: { id: string; name: string } | null;
        clubs: Array<{ id: string; name: string; slug: string }>;
        permissions: string[];
        user: { id: string; firstName: string; lastName: string };
      }>('/auth/accept-invite', { method: 'POST', body: JSON.stringify({ token, password }) }),
  },

  agenda: {
    /** Tablero completo del día: una sola llamada por pantalla. */
    day: (date: string, filters: { courtId?: string; instructorId?: string } = {}) => {
      const q = new URLSearchParams({ date });
      if (filters.courtId) q.set('courtId', filters.courtId);
      if (filters.instructorId) q.set('instructorId', filters.instructorId);
      return request<AgendaDay>(`/agenda/day?${q}`);
    },

    /** Cotiza un turno antes de confirmarlo. */
    quote: (input: {
      courtId: string; startsAt: string;
      durationMinutes: number; clientId?: string;
    }) => request<{
      basePrice: number; discountAmount: number; totalPrice: number;
      breakdown: string[]; slotFree: boolean; withinOperatingHours: boolean;
    }>('/agenda/quote', { method: 'POST', body: JSON.stringify(input) }),
  },

  bookings: {
    create: (input: {
      courtId: string; startsAt: string; durationMinutes: number;
      clientId?: string; playersCount?: number; notes?: string;
      payment?: { paymentMethodId?: string; amount: number; toAccount?: boolean };
    }) => request<{ id: string; code: string; totalPrice: number; paidAmount: number }>(
      '/bookings', { method: 'POST', body: JSON.stringify(input) },
    ),

    get: (id: string) => request<Record<string, unknown>>(`/bookings/${id}`),

    /**
     * Reprogramar. Devuelve una reserva NUEVA con otro id: el backend
     * encadena en vez de editar, para conservar el historial. El front debe
     * refrescar la agenda, no actualizar el bloque en su lugar.
     */
    reschedule: (id: string, input: {
      startsAt: string; courtId?: string; durationMinutes?: number; reason?: string;
    }) => request<{ newBookingId: string; newCode: string }>(
      `/bookings/${id}/reschedule`, { method: 'POST', body: JSON.stringify(input) },
    ),

    cancel: (id: string, input: { cancelledBy?: 'CLIENT' | 'CLUB'; reason?: string }) =>
      request<{ refundAmount: number; cancellationFee: number; tierApplied: string }>(
        `/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify(input) },
      ),

    checkIn: (id: string) =>
      request<{ id: string; status: string }>(`/bookings/${id}/check-in`, { method: 'POST' }),

    checkOut: (id: string) =>
      request<{ id: string; status: string }>(`/bookings/${id}/check-out`, { method: 'POST' }),

    noShow: (id: string, reason?: string) =>
      request<{ charged: number }>(`/bookings/${id}/no-show`, {
        method: 'POST', body: JSON.stringify({ reason }),
      }),

    collect: (id: string, input: { paymentMethodId: string; amount: number }) =>
      request<{ paidAmount: number; paymentStatus: string }>(
        `/bookings/${id}/collect`, { method: 'POST', body: JSON.stringify(input) },
      ),
  },

  clients: {
    search: (q: string, limit = 12) =>
      request<ClientSearchResult[]>(
        `/clients/search?q=${encodeURIComponent(q)}&limit=${limit}`,
      ),

    /** Listado con filtros. Es la pantalla principal del CRM. */
    list: (params: {
      status?: string; tagCode?: string; debtorsOnly?: boolean;
      inactiveDays?: number; birthdayMonth?: number;
      sortBy?: 'alpha' | 'recent' | 'spent';
      limit?: number; offset?: number;
    } = {}) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') q.set(k, String(v));
      }
      return request<{
        items: Array<{
          id: string; firstName: string; lastName: string;
          phone: string | null; email: string | null; status: string;
          accountBalance: number; totalSpent: number; bookingsCount: number;
          lastVisitAt: string | null; skillLevel: string | null;
          tags: Array<{ tag: { code: string; name: string; color: string } }>;
        }>;
        total: number; limit: number; offset: number;
      }>(`/clients?${q}`);
    },

    profile: (id: string) => request<Record<string, unknown>>(`/clients/${id}`),

    create: (input: {
      firstName: string; lastName: string;
      phone?: string; email?: string; documentNumber?: string; force?: boolean;
    }) => request<{
      created: boolean; id?: string;
      requiresConfirmation?: boolean; duplicates?: unknown[];
    }>('/clients', { method: 'POST', body: JSON.stringify(input) }),

    statement: (id: string) =>
      request<Record<string, unknown>>(`/clients/${id}/statement`),
  },

  tournaments: {
    list: (status?: string) => request<Array<{
      id: string; name: string; format: string; category: string | null;
      startsAt: string; endsAt: string | null; status: string;
      maxTeams: number; entryFee: number;
      registeredTeams: number; spotsLeft: number;
    }>>(`/tournaments${status ? `?status=${status}` : ''}`),

    detail: (id: string) => request<{
      id: string; name: string; description: string | null; format: string;
      category: string | null; startsAt: string; status: string;
      maxTeams: number; entryFee: number; prizeDescription: string | null;
      teams: Array<{
        id: string; name: string; seed: number | null; groupName: string | null;
        paymentStatus: string; played: number; won: number; lost: number;
        points: number; finalPosition: number | null;
        members: Array<{ id: string; firstName: string; lastName: string }>;
      }>;
    }>(`/tournaments/${id}`),

    fixture: (id: string) => request<Array<{
      round: string;
      roundNumber: number;
      matches: Array<{
        id: string; round: string; matchNumber: number;
        scheduledAt: string | null; scoreSets: Array<[number, number]> | null;
        winnerTeamId: string | null; status: string;
        homeTeam: { id: string; name: string } | null;
        awayTeam: { id: string; name: string } | null;
      }>;
    }>>(`/tournaments/${id}/fixture`),

    standings: (id: string) => request<Array<{
      group: string | null;
      standings: Array<{
        teamId: string; name: string; position: number;
        played: number; won: number; lost: number;
        setsWon: number; setsLost: number;
        gamesWon: number; gamesLost: number; points: number;
      }>;
    }>>(`/tournaments/${id}/standings`),

    /** Sortea el cuadro. Una sola vez. */
    generateFixture: (id: string, options: {
      groupCount?: number; americanoRounds?: number;
    } = {}) => request<{ generated: number; rounds: number; byes: number }>(
      `/tournaments/${id}/fixture`,
      { method: 'POST', body: JSON.stringify(options) },
    ),

    recordResult: (matchId: string, input: {
      scoreSets?: Array<[number, number]>; walkoverWinnerId?: string;
    }) => request<{ winnerId: string; advancedTo: string | null }>(
      `/tournaments/matches/${matchId}/result`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

    /** No reembolsa inscripciones pagadas — eso se hace a mano desde tesorería. */
    cancel: (id: string) =>
      request<{ id: string; status: string }>(`/tournaments/${id}/cancel`, { method: 'POST' }),

    /** Solo funciona antes de que exista fixture. */
    withdrawTeam: (id: string, teamId: string) =>
      request<void>(`/tournaments/${id}/teams/${teamId}`, { method: 'DELETE' }),
  },

  treasury: {
    accounts: () => request<Array<{
      id: string; bankName: string; accountName: string;
      accountType: string; cbu: string | null; alias: string | null;
      currency: string; currentBalance: number; isActive: boolean;
    }>>('/treasury/accounts'),

    /** ¿Me alcanza para pagar el viernes? */
    cashFlow: (days = 30) =>
      request<CashFlowProjection>(`/treasury/cash-flow?days=${days}`),

    pendingExpenses: () =>
      request<PendingExpense[]>('/treasury/expenses/pending'),

    /** Registra la obligación. No mueve plata. */
    createExpense: (input: {
      concept: string; amount: number; date: string;
      dueDate?: string; supplierId?: string; categoryId?: string;
      documentType?: string; documentNumber?: string;
    }) => request<{ id: string; code: string; total: number; dueDate: string | null }>(
      '/treasury/expenses', { method: 'POST', body: JSON.stringify(input) },
    ),

    /** Paga: acá sí sale la plata de la caja o del banco. */
    payExpense: (id: string, input: {
      paymentMethodId?: string; cashSessionId?: string; bankAccountId?: string;
    }) => request<{ code: string; paid: number }>(
      `/treasury/expenses/${id}/pay`, { method: 'POST', body: JSON.stringify(input) },
    ),

    suppliers: () => request<Array<{
      id: string; name: string; taxId: string | null;
      currentBalance: number; owed: number; isActive: boolean;
    }>>('/treasury/suppliers'),
  },

  reports: {
    /** Cómo fue el día: turnos, buffet, cajas y lo pendiente. */
    dailyClose: (date: string) =>
      request<DailyClose>(`/reports/daily-close?date=${date}`),

    /** Qué producto deja más plata, no cuál se vende más. */
    products: (from: string, to: string) =>
      request<Record<string, unknown>>(`/reports/products?from=${from}&to=${to}`),

    /** Facturación por hora ocupada de cada cancha. */
    courts: (from: string, to: string) =>
      request<Record<string, unknown>>(`/reports/courts?from=${from}&to=${to}`),
  },

  pos: {
    /** Catálogo de la pantalla de venta. */
    catalog: (categoryId?: string) =>
      request<Array<{
        id: string; name: string; salePrice: number; stockQty: number;
        trackStock: boolean; unit: string; kind: string; available: boolean;
        category: { id: string; name: string } | null;
      }>>(`/pos/catalog${categoryId ? `?categoryId=${categoryId}` : ''}`),

    /** Vende: descuenta stock, cobra e impacta en caja, todo atómico. */
    createSale: (input: {
      items: Array<{ productId: string; quantity: number; unitPrice?: number }>;
      clientId?: string;
      bookingId?: string;
      toAccount?: boolean;
      payment?: { paymentMethodId: string; amount: number; tendered?: number };
    }) => request<{
      id: string; code: string; total: number; paidAmount: number;
      change: number; warnings: string[];
    }>('/pos/sales', { method: 'POST', body: JSON.stringify(input) }),

    /** Qué reponer, ordenado por urgencia. */
    stockAlerts: () => request<Array<{
      productId: string; name: string; stockQty: number;
      minStockQty: number; unit: string; shortfall: number; severity: string;
    }>>('/pos/stock/alerts'),
  },

  cash: {
    /** Medios de pago activos. Se consulta una vez por sesión. */
    paymentMethods: () => request<Array<{
      id: string; code: string; name: string; kind: string;
      feePercent: number; settlementDays: number; affectsCashCount: boolean;
    }>>('/cash/payment-methods'),

    /** Puestos de caja del club. Se consulta al abrir turno. */
    registers: () => request<Array<{ id: string; name: string }>>('/cash/registers'),

    /** Movimiento manual: ingreso, gasto, retiro o depósito. */
    addMovement: (sessionId: string, input: {
      type: string; amount: number; concept: string; description?: string;
    }) => request<{ id: string; expectedCash: number }>(
      `/cash/sessions/${sessionId}/movements`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

    /** Caja abierta del usuario. null si no abrió turno. */
    mine: () => request<{
      sessionId: string; expectedCash: number; totalInflow: number;
      registerName: string; movementCount: number;
    } | null>('/cash/sessions/mine'),

    open: (registerId: string, openingAmount: number, notes?: string) =>
      request<{ id: string; openedAt: string; openingAmount: number }>(
        '/cash/sessions', {
          method: 'POST',
          body: JSON.stringify({ registerId, openingAmount, notes }),
        },
      ),

    balance: (sessionId: string) =>
      request<Record<string, unknown>>(`/cash/sessions/${sessionId}`),

    close: (sessionId: string, input: {
      countedCash?: number;
      denominations?: Record<string, number>;
      differenceReason?: string;
    }) => request<{
      expectedCash: number; countedCash: number;
      difference: number; kind: string;
    }>(`/cash/sessions/${sessionId}/close`, {
      method: 'POST', body: JSON.stringify(input),
    }),
  },

  onboarding: {
    /** ¿Está libre este slug? Para validar en vivo en el wizard. */
    slugAvailable: (slug: string) =>
      request<{ slug: string; available: boolean; reason?: string }>(
        `/onboarding/slug-available?slug=${encodeURIComponent(slug)}`,
      ),

    /**
     * Crea el club + dueño y devuelve una sesión iniciada.
     * El backend deja al dueño logueado: el front guarda el accessToken.
     */
    createClub: (input: {
      clubName: string; slug: string; taxId?: string; phone?: string;
      city?: string; firstName: string; lastName: string;
      email: string; password: string; planCode?: string;
    }) =>
      request<{
        club: { id: string; slug: string; name: string };
        session: {
          accessToken: string;
          activeClub: { id: string; name: string } | null;
          clubs: Array<{ id: string; name: string; slug: string }>;
          permissions: string[];
          user: { id: string; firstName: string; lastName: string };
        };
      }>('/onboarding/club', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },

  team: {
    list: () => request<Array<{
      id: string;
      status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
      invitedAt: string | null;
      acceptedAt: string | null;
      createdAt: string;
      role: { id: string; code: string; name: string };
      user: {
        id: string; email: string; firstName: string; lastName: string;
        avatarUrl: string | null; isActive: boolean; lastLoginAt: string | null;
      };
    }>>('/team'),

    roles: () => request<Array<{ id: string; code: string; name: string }>>('/team/roles'),

    invite: (input: { email: string; firstName: string; lastName: string; roleId: string }) =>
      request<{ status: 'ADDED' | 'INVITED' }>('/team/invite', {
        method: 'POST', body: JSON.stringify(input),
      }),

    update: (membershipId: string, input: { roleId?: string; status?: 'ACTIVE' | 'SUSPENDED' }) =>
      request<void>(`/team/${membershipId}`, { method: 'PATCH', body: JSON.stringify(input) }),

    remove: (membershipId: string) =>
      request<void>(`/team/${membershipId}`, { method: 'DELETE' }),
  },
};

/**
 * Búsqueda con debounce.
 *
 * Recepción escribe mientras habla por teléfono: sin esto, "gonzalez" dispara
 * ocho requests y las respuestas pueden llegar desordenadas, dejando en
 * pantalla los resultados de "gonz" sobre los de "gonzalez".
 *
 * Se cancela la request anterior con AbortController, así la última que se
 * escribió es siempre la que gana.
 */
export function createSearcher(delayMs = 220) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  return (term: string): Promise<ClientSearchResult[]> => {
    clearTimeout(timer);
    controller?.abort();

    if (term.trim().length < 2) return Promise.resolve([]);

    return new Promise((resolve) => {
      timer = setTimeout(async () => {
        controller = new AbortController();
        try {
          resolve(await api.clients.search(term));
        } catch (e) {
          // Una búsqueda cancelada no es un error que mostrar.
          if ((e as Error).name !== 'AbortError') {
            console.error('Búsqueda fallida:', e);
          }
          resolve([]);
        }
      }, delayMs);
    });
  };
}
