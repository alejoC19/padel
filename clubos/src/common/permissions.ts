/**
 * Catálogo de permisos de ClubOS.
 *
 * Fuente única de verdad. Los permisos son código, no datos editables:
 * un permiso nuevo requiere deploy, no un INSERT. Esto evita el clásico
 * "tabla Permission vacía en producción" y permite autocompletado + type
 * safety en los decoradores.
 *
 * Convención: `<recurso>.<acción>`
 */

export const PERMISSIONS = {
  // --- Agenda y reservas ---
  BOOKING_VIEW: 'booking.view',
  BOOKING_CREATE: 'booking.create',
  BOOKING_UPDATE: 'booking.update',
  BOOKING_CANCEL: 'booking.cancel',
  BOOKING_RESCHEDULE: 'booking.reschedule',
  BOOKING_CHECKIN: 'booking.checkin',
  BOOKING_NO_SHOW: 'booking.no_show',
  BOOKING_OVERRIDE: 'booking.override', // saltear validaciones de política

  // --- Canchas ---
  COURT_VIEW: 'court.view',
  COURT_MANAGE: 'court.manage',
  COURT_BLOCK: 'court.block',

  // --- Clientes / CRM ---
  CLIENT_VIEW: 'client.view',
  CLIENT_CREATE: 'client.create',
  CLIENT_UPDATE: 'client.update',
  CLIENT_DELETE: 'client.delete',
  CLIENT_VIEW_FINANCIALS: 'client.view_financials',
  CLIENT_NOTE_INTERNAL: 'client.note_internal',
  CLIENT_EXPORT: 'client.export',

  // --- Caja ---
  CASH_VIEW: 'cash.view',
  CASH_OPEN: 'cash.open',
  CASH_CLOSE: 'cash.close',
  CASH_MOVEMENT: 'cash.movement',
  CASH_WITHDRAWAL: 'cash.withdrawal',
  CASH_VIEW_ALL_SESSIONS: 'cash.view_all_sessions', // no solo la propia
  CASH_ADJUST: 'cash.adjust',

  // --- Pagos ---
  PAYMENT_VIEW: 'payment.view',
  PAYMENT_CREATE: 'payment.create',
  PAYMENT_REFUND: 'payment.refund',

  // --- Cuenta corriente ---
  ACCOUNT_VIEW: 'account.view',
  ACCOUNT_CHARGE: 'account.charge',
  ACCOUNT_CREDIT_LIMIT: 'account.credit_limit',

  // --- Productos y stock ---
  PRODUCT_VIEW: 'product.view',
  PRODUCT_MANAGE: 'product.manage',
  STOCK_ADJUST: 'stock.adjust',
  SALE_CREATE: 'sale.create',
  SALE_VOID: 'sale.void',

  // --- Profesores ---
  INSTRUCTOR_VIEW: 'instructor.view',
  INSTRUCTOR_MANAGE: 'instructor.manage',
  INSTRUCTOR_VIEW_OWN_AGENDA: 'instructor.view_own_agenda',
  COMMISSION_VIEW: 'commission.view',
  COMMISSION_APPROVE: 'commission.approve',

  // --- Membresías ---
  MEMBERSHIP_VIEW: 'membership.view',
  MEMBERSHIP_MANAGE: 'membership.manage',

  // --- Tesorería ---
  TREASURY_VIEW: 'treasury.view',
  TREASURY_MANAGE: 'treasury.manage',
  BANK_RECONCILE: 'bank.reconcile',
  EXPENSE_VIEW: 'expense.view',
  EXPENSE_CREATE: 'expense.create',
  EXPENSE_APPROVE: 'expense.approve',
  SUPPLIER_MANAGE: 'supplier.manage',

  // --- Precios ---
  PRICE_VIEW: 'price.view',
  PRICE_MANAGE: 'price.manage',

  // --- Torneos ---
  TOURNAMENT_VIEW: 'tournament.view',
  TOURNAMENT_MANAGE: 'tournament.manage',

  // --- Reportes ---
  REPORT_OPERATIONAL: 'report.operational',
  REPORT_FINANCIAL: 'report.financial',
  REPORT_EXPORT: 'report.export',

  // --- Administración del club ---
  CLUB_SETTINGS: 'club.settings',
  CLUB_BILLING: 'club.billing',
  USER_VIEW: 'user.view',
  USER_INVITE: 'user.invite',
  USER_MANAGE: 'user.manage',
  ROLE_MANAGE: 'role.manage',
  AUDIT_VIEW: 'audit.view',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

/**
 * Presets por rol del sistema.
 *
 * Criterio aplicado:
 *  - RECEPTION opera el día a día pero NO ve rentabilidad ni toca precios.
 *    Es el rol con más rotación de personal; darle acceso financiero es
 *    el error de seguridad más común en software de clubes.
 *  - INSTRUCTOR solo ve su propia agenda y sus propias comisiones.
 *  - CLIENT no tiene permisos de backoffice: usa endpoints del portal,
 *    que filtran por su propio clientId.
 */
export const ROLE_PRESETS: Record<string, Permission[]> = {
  OWNER: ALL_PERMISSIONS,

  ADMIN: ALL_PERMISSIONS.filter(
    (p) =>
      p !== PERMISSIONS.CLUB_BILLING &&
      p !== PERMISSIONS.ROLE_MANAGE,
  ),

  RECEPTION: [
    PERMISSIONS.BOOKING_VIEW,
    PERMISSIONS.BOOKING_CREATE,
    PERMISSIONS.BOOKING_UPDATE,
    PERMISSIONS.BOOKING_CANCEL,
    PERMISSIONS.BOOKING_RESCHEDULE,
    PERMISSIONS.BOOKING_CHECKIN,
    PERMISSIONS.BOOKING_NO_SHOW,
    PERMISSIONS.COURT_VIEW,
    PERMISSIONS.CLIENT_VIEW,
    PERMISSIONS.CLIENT_CREATE,
    PERMISSIONS.CLIENT_UPDATE,
    PERMISSIONS.CASH_VIEW,
    PERMISSIONS.CASH_OPEN,
    PERMISSIONS.CASH_CLOSE,
    PERMISSIONS.CASH_MOVEMENT,
    PERMISSIONS.PAYMENT_VIEW,
    PERMISSIONS.PAYMENT_CREATE,
    PERMISSIONS.ACCOUNT_VIEW,
    PERMISSIONS.PRODUCT_VIEW,
    PERMISSIONS.SALE_CREATE,
    PERMISSIONS.INSTRUCTOR_VIEW,
    PERMISSIONS.MEMBERSHIP_VIEW,
    PERMISSIONS.PRICE_VIEW,
    PERMISSIONS.TOURNAMENT_VIEW,
  ],

  INSTRUCTOR: [
    PERMISSIONS.BOOKING_VIEW,
    PERMISSIONS.INSTRUCTOR_VIEW_OWN_AGENDA,
    PERMISSIONS.BOOKING_CHECKIN,
    PERMISSIONS.CLIENT_VIEW,
    PERMISSIONS.COMMISSION_VIEW,
    PERMISSIONS.COURT_VIEW,
  ],

  CLIENT: [],
};
