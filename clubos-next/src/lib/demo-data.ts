import type { AgendaDay, ClientSearchResult } from './api';
import { todayISO } from './grid';

/**
 * Datos de ejemplo.
 *
 * Respetan exactamente la forma que devuelve `GET /agenda/day`, así que la
 * pantalla no necesita ramas distintas según haya backend o no: cambia el
 * origen del dato, no el código que lo dibuja.
 *
 * Sirven para dos cosas: mostrarle la agenda a un club sin montar nada, y
 * trabajar en la interfaz sin depender de que el servidor esté levantado.
 */

const iso = (minute: number): string => {
  const d = new Date();
  d.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return d.toISOString();
};

const booking = (
  n: number, courtId: string, startMinute: number, durationMinutes: number,
  title: string,
  extra: Partial<AgendaDay['bookings'][number]> = {},
): AgendaDay['bookings'][number] => ({
  id: `demo-${n}`,
  code: `R-2026-${String(180 + n).padStart(5, '0')}`,
  courtId,
  startsAt: iso(startMinute),
  endsAt: iso(startMinute + durationMinutes),
  startMinute,
  endMinute: startMinute + durationMinutes,
  durationMinutes,
  type: 'REGULAR',
  status: 'CONFIRMED',
  paymentStatus: 'PAID',
  title,
  clientId: `cl-${n}`,
  clientPhone: '11 4567-8900',
  instructorName: null,
  playersCount: 4,
  totalPrice: 24000,
  paidAmount: 24000,
  pendingAmount: 0,
  checkInAt: null,
  hasNotes: false,
  ...extra,
});

export const DEMO_DAY: AgendaDay = {
  date: todayISO(),
  timezone: 'America/Argentina/Buenos_Aires',
  openMinute: 8 * 60,
  closeMinute: 24 * 60,
  courts: [
    { id: 'c1', name: 'Cancha 1', number: 1, color: '#3B82F6', status: 'AVAILABLE',
      slotMinutes: 30, capacity: 4, environment: 'INDOOR', openMinute: 480, closeMinute: 1440 },
    { id: 'c2', name: 'Cancha 2', number: 2, color: '#10B981', status: 'AVAILABLE',
      slotMinutes: 30, capacity: 4, environment: 'INDOOR', openMinute: 480, closeMinute: 1440 },
    { id: 'c3', name: 'Cancha 3', number: 3, color: '#F59E0B', status: 'AVAILABLE',
      slotMinutes: 30, capacity: 4, environment: 'OUTDOOR', openMinute: 480, closeMinute: 1440 },
    { id: 'c4', name: 'Cancha 4', number: 4, color: '#A855F7', status: 'AVAILABLE',
      slotMinutes: 30, capacity: 4, environment: 'OUTDOOR', openMinute: 480, closeMinute: 1440 },
  ],
  bookings: [
    booking(1, 'c1', 9 * 60, 90, 'Martina Ferreyra', { status: 'COMPLETED', totalPrice: 18000, paidAmount: 18000 }),
    booking(2, 'c1', 11 * 60, 90, 'Diego Sosa', { status: 'PAID', totalPrice: 18000, paidAmount: 18000 }),
    booking(3, 'c1', 14 * 60, 90, 'Escuela · Nivel 2', {
      type: 'LESSON', instructorName: 'Pablo Ruiz', playersCount: 6, clientId: null, clientPhone: null,
    }),
    booking(4, 'c1', 18 * 60, 90, 'Juan Carlos Pérez', {
      status: 'CONFIRMED', paymentStatus: 'UNPAID', paidAmount: 0, pendingAmount: 24000,
    }),
    booking(5, 'c1', 20 * 60, 90, 'Lucía Bianchi', {
      status: 'CONFIRMED', paymentStatus: 'PARTIAL', paidAmount: 12000, pendingAmount: 12000,
    }),

    booking(6, 'c2', 10 * 60, 90, 'Ana Rodríguez', { status: 'PAID', totalPrice: 18000, paidAmount: 18000 }),
    booking(7, 'c2', 13 * 60, 60, 'María Ñañez', {
      status: 'COMPLETED', totalPrice: 13000, paidAmount: 13000, playersCount: 2,
    }),
    booking(8, 'c2', 19 * 60, 90, 'José González', {
      status: 'PENDING', paymentStatus: 'UNPAID', paidAmount: 0, pendingAmount: 24000, hasNotes: true,
    }),
    booking(9, 'c2', 21 * 60, 90, 'Martina Ferreyra'),

    booking(10, 'c3', 9 * 60 + 30, 90, 'Torneo Apertura · Zona A', {
      type: 'TOURNAMENT', playersCount: 8, totalPrice: 0, paidAmount: 0, clientId: null, clientPhone: null,
    }),
    booking(11, 'c3', 11 * 60, 90, 'Torneo Apertura · Zona A', {
      type: 'TOURNAMENT', playersCount: 8, totalPrice: 0, paidAmount: 0, clientId: null, clientPhone: null,
    }),
    booking(12, 'c3', 16 * 60, 120, 'Mantenimiento · cambio de red', {
      type: 'MAINTENANCE', playersCount: 0, totalPrice: 0, paidAmount: 0, clientId: null, clientPhone: null,
    }),
    booking(13, 'c3', 20 * 60, 90, 'Diego Sosa', {
      status: 'CONFIRMED', paymentStatus: 'UNPAID', totalPrice: 26000, paidAmount: 0, pendingAmount: 26000,
    }),

    booking(14, 'c4', 8 * 60 + 30, 90, 'Juan Carlos Pérez', {
      status: 'COMPLETED', totalPrice: 18000, paidAmount: 18000,
    }),
    booking(15, 'c4', 12 * 60, 90, 'Lucía Bianchi', {
      status: 'COMPLETED', totalPrice: 18000, paidAmount: 18000,
    }),
    booking(16, 'c4', 17 * 60, 90, 'Escuela · Iniciación', {
      type: 'LESSON', instructorName: 'Sofía Vera', playersCount: 6, clientId: null, clientPhone: null,
    }),
    booking(17, 'c4', 19 * 60, 90, 'Ana Rodríguez'),
  ],
  blocks: [],
  summary: {
    bookingsCount: 14,
    occupancyPercent: 24.2,
    revenue: 157000,
    pendingRevenue: 62000,
    cancelledCount: 0,
    noShowCount: 0,
  },
};

export const DEMO_CLIENTS: ClientSearchResult[] = [
  { id: 'k1', firstName: 'Martina', lastName: 'Ferreyra', phone: '11 4567-8900',
    email: null, documentNumber: '32114556', status: 'ACTIVE', accountBalance: 0,
    lastVisitAt: null, score: 1 },
  { id: 'k2', firstName: 'José', lastName: 'González', phone: '11 5678-9011',
    email: null, documentNumber: '30111333', status: 'ACTIVE', accountBalance: -18000,
    lastVisitAt: null, score: 1 },
  { id: 'k3', firstName: 'Ana', lastName: 'Rodríguez', phone: '11 6789-0122',
    email: null, documentNumber: '31222444', status: 'ACTIVE', accountBalance: 0,
    lastVisitAt: null, score: 1 },
  { id: 'k4', firstName: 'Juan Carlos', lastName: 'Pérez', phone: '11 7890-1233',
    email: null, documentNumber: '33444555', status: 'ACTIVE', accountBalance: 4500,
    lastVisitAt: null, score: 1 },
  { id: 'k5', firstName: 'María', lastName: 'Ñañez', phone: '11 8901-2344',
    email: null, documentNumber: '28999888', status: 'ACTIVE', accountBalance: 0,
    lastVisitAt: null, score: 1 },
  { id: 'k6', firstName: 'Diego', lastName: 'Sosa', phone: '11 9012-3455',
    email: null, documentNumber: '29777111', status: 'ACTIVE', accountBalance: -9000,
    lastVisitAt: null, score: 1 },
  { id: 'k7', firstName: 'Lucía', lastName: 'Bianchi', phone: '11 2345-6788',
    email: null, documentNumber: '35888222', status: 'ACTIVE', accountBalance: 0,
    lastVisitAt: null, score: 1 },
];

/* =========================================================================
   DATOS DEMO — resto de módulos (caja, buffet, torneos, tesorería, reportes)
   -------------------------------------------------------------------------
   Todos pertenecen al mismo club ficticio "Club Demo Pádel" y usan los mismos
   clientes de DEMO_CLIENTS. Los números son coherentes entre módulos: los
   cobros de caja se corresponden con reservas y ventas de buffet.
   ========================================================================= */

/** Caja: turno abierto con movimientos coherentes con reservas y buffet. */
export const DEMO_CASH = {
  sessionId: 'demo-cash-1',
  registerName: 'Caja principal',
  operator: 'Recepción',
  openedAt: `${todayISO()}T08:00:00`,
  openingAmount: 15000,
  status: 'OPEN' as const,
  movements: [
    { id: 'm1', at: `${todayISO()}T09:15:00`, concept: 'Turno cancha 1 — Ferreyra', method: 'Efectivo', in: 18000, out: 0 },
    { id: 'm2', at: `${todayISO()}T10:30:00`, concept: 'Turno cancha 3 — Pérez', method: 'Tarjeta', in: 24000, out: 0 },
    { id: 'm3', at: `${todayISO()}T11:00:00`, concept: 'Buffet — varios', method: 'Efectivo', in: 8500, out: 0 },
    { id: 'm4', at: `${todayISO()}T12:20:00`, concept: 'Turno cancha 2 — Sosa', method: 'Transferencia', in: 26000, out: 0 },
    { id: 'm5', at: `${todayISO()}T13:00:00`, concept: 'Compra de hielo', method: 'Efectivo', in: 0, out: 3500 },
    { id: 'm6', at: `${todayISO()}T14:10:00`, concept: 'Buffet — bebidas', method: 'Efectivo', in: 12000, out: 0 },
  ],
  byMethod: { efectivo: 35000, tarjeta: 24000, transferencia: 26000 },
  expectedCash: 15000 + 18000 + 8500 + 12000 - 3500, // apertura + ingresos efectivo - egresos
  totalInflow: 88500,
  totalOutflow: 3500,
};

/** Buffet: catálogo con categorías, precios y stock coherentes. */
export const DEMO_PRODUCTS = [
  { id: 'p1', name: 'Agua 500ml', category: 'Bebidas', salePrice: 1200, stockQty: 48, trackStock: true, unit: 'u', kind: 'PRODUCT', available: true },
  { id: 'p2', name: 'Gaseosa 500ml', category: 'Bebidas', salePrice: 2000, stockQty: 36, trackStock: true, unit: 'u', kind: 'PRODUCT', available: true },
  { id: 'p3', name: 'Energizante', category: 'Bebidas', salePrice: 3500, stockQty: 18, trackStock: true, unit: 'u', kind: 'PRODUCT', available: true },
  { id: 'p4', name: 'Café', category: 'Cafetería', salePrice: 1800, stockQty: 99, trackStock: false, unit: 'u', kind: 'PRODUCT', available: true },
  { id: 'p5', name: 'Alfajor', category: 'Kiosco', salePrice: 1500, stockQty: 24, trackStock: true, unit: 'u', kind: 'PRODUCT', available: true },
  { id: 'p6', name: 'Barra de cereal', category: 'Kiosco', salePrice: 1300, stockQty: 30, trackStock: true, unit: 'u', kind: 'PRODUCT', available: true },
  { id: 'p7', name: 'Papas fritas', category: 'Kiosco', salePrice: 2200, stockQty: 5, trackStock: true, unit: 'u', kind: 'PRODUCT', available: true },
  { id: 'p8', name: 'Pelota Head (tubo)', category: 'Pádel', salePrice: 9000, stockQty: 12, trackStock: true, unit: 'u', kind: 'PRODUCT', available: true },
];

/** Torneos: un torneo con parejas, fixture y resultados coherentes. */
export const DEMO_TOURNAMENTS = [
  {
    id: 't1',
    name: 'Open ClubOS — Agosto 2026',
    category: 'Dobles Masculino',
    format: 'Eliminación',
    status: 'IN_PROGRESS',
    startsAt: `${todayISO()}T18:00:00`,
    maxTeams: 8,
    entryFee: 12000,
    registeredTeams: 4,
    spotsLeft: 4,
    teams: [
      { id: 'tm1', name: 'Pérez / Sosa', seed: 1 },
      { id: 'tm2', name: 'González / Ruiz', seed: 2 },
      { id: 'tm3', name: 'Ferreyra / Bianchi', seed: 3 },
      { id: 'tm4', name: 'Rodríguez / Vera', seed: 4 },
    ],
    matches: [
      { id: 'mt1', round: 'Semifinal', home: 'Pérez / Sosa', away: 'Rodríguez / Vera', score: '6-3, 6-4', status: 'COMPLETED', winner: 'Pérez / Sosa' },
      { id: 'mt2', round: 'Semifinal', home: 'González / Ruiz', away: 'Ferreyra / Bianchi', score: '7-5, 6-7, 6-2', status: 'COMPLETED', winner: 'González / Ruiz' },
      { id: 'mt3', round: 'Final', home: 'Pérez / Sosa', away: 'González / Ruiz', score: null, status: 'SCHEDULED', winner: null },
    ],
  },
];

/** Tesorería: disponible, bancos, por cobrar y por pagar. */
export const DEMO_TREASURY = {
  availableToday: 156000,
  banks: 420000,
  cashOnHand: 50000,
  pendingIncome: 62000,
  pendingExpenses: 88000,
  projectedBalance: 156000 + 62000 - 88000,
  expenses: [
    { id: 'e1', concept: 'Alquiler cancha techada', supplier: 'Inmobiliaria Sur', total: 45000, dueDate: `${todayISO()}`, isOverdue: false, daysToDue: 0 },
    { id: 'e2', concept: 'Proveedor bebidas', supplier: 'Distribuidora Norte', total: 28000, dueDate: null, isOverdue: false, daysToDue: 3 },
    { id: 'e3', concept: 'Servicio de luz', supplier: 'Edenor', total: 15000, dueDate: `${todayISO()}`, isOverdue: true, daysToDue: -2 },
  ],
  alerts: [
    { severity: 'HIGH' as const, message: 'Servicio de luz vencido hace 2 días ($15.000)' },
    { severity: 'MEDIUM' as const, message: 'Alquiler vence hoy ($45.000)' },
  ],
};

/** Reportes: cierre del día coherente con caja y agenda. */
export const DEMO_REPORTS = {
  date: todayISO(),
  billed: 157000,
  collected: 95000,
  pending: 62000,
  outflow: 3500,
  net: 91500,
  bookings: { total: 14, played: 11, cancelled: 2, noShow: 1, occupancyPercent: 24 },
  buffet: { sales: 20500, cost: 9000, grossProfit: 11500, marginPercent: 56 },
  byMethod: [
    { name: 'Efectivo', amount: 35000 },
    { name: 'Tarjeta', amount: 24000 },
    { name: 'Transferencia', amount: 26000 },
    { name: 'Cuenta corriente', amount: 10000 },
  ],
};
