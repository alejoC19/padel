import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AgendaStore, type AgendaState } from '@/lib/agenda-store';

/**
 * Conecta el AgendaStore a React.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ useSyncExternalStore Y NO useState
 * ---------------------------------------------------------------------------
 * El store ya existía y funciona fuera de React: tiene la lógica de
 * optimismo, reversión y control de carreras, y está cubierto por tests que
 * no necesitan un DOM. Reescribirlo como estado de React habría significado
 * tirar todo eso.
 *
 * `useSyncExternalStore` es exactamente para este caso: React se suscribe a
 * una fuente externa y se entera de los cambios. Además evita el "tearing"
 * en modo concurrente — dos componentes leyendo el store en el mismo render
 * ven siempre la misma versión.
 * ---------------------------------------------------------------------------
 */
export function useAgendaStore(store: AgendaStore): Readonly<AgendaState> {
  return useSyncExternalStore(
    useCallback((cb) => store.subscribe(cb), [store]),
    useCallback(() => store.get(), [store]),
    // Snapshot del servidor. Next intenta prerenderizar la página y sin este
    // tercer argumento falla el build entero.
    //
    // Devuelve el mismo objeto que el cliente porque el store arranca vacío:
    // en el servidor no hay sesión ni datos que mostrar, así que el HTML
    // inicial es el estado de carga. Es correcto que sea así — la agenda
    // depende de un token que vive en el navegador.
    useCallback(() => store.get(), [store]),
  );
}

/**
 * Store único para toda la app.
 *
 * Se crea fuera del componente: si viviera en un `useState`, un remount lo
 * recrearía y se perdería el día cargado.
 */
export const agendaStore = new AgendaStore();

/**
 * Refresco automático de la agenda.
 *
 * Dos disparadores:
 *   - cada N segundos, porque otro operador puede haber cargado un turno
 *   - al volver a la pestaña, porque mirar una agenda de hace veinte minutos
 *     es exactamente cómo se cargan turnos duplicados
 *
 * `enabled` lo apaga durante un arrastre: recargar mientras alguien mueve un
 * bloque le arranca el turno de la mano.
 */
export function useAutoRefresh(
  onRefresh: () => void,
  { enabled = true, intervalMs = 45_000 }: { enabled?: boolean; intervalMs?: number } = {},
): void {
  // La ref evita reiniciar el intervalo en cada render por un callback nuevo.
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (!document.hidden) cb.current();
    };
    const timer = setInterval(tick, intervalMs);

    const onVisible = () => {
      if (!document.hidden) cb.current();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, intervalMs]);
}

/**
 * Minuto actual del día, para la línea de "ahora".
 *
 * Se actualiza al minuto exacto, no cada 60 segundos desde que montó: si
 * arrancara a los 30 segundos de un minuto, la línea saltaría siempre a
 * destiempo respecto del reloj de la pared.
 */
export function useCurrentMinute(): number {
  const [minute, setMinute] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      const now = new Date();
      const msToNextMinute =
        (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
      timer = setTimeout(() => {
        const n = new Date();
        setMinute(n.getHours() * 60 + n.getMinutes());
        schedule();
      }, msToNextMinute);
    };

    schedule();
    return () => clearTimeout(timer);
  }, []);

  return minute;
}

export interface Toast {
  id: number;
  message: string;
  kind: 'ok' | 'error';
}

/**
 * Avisos efímeros.
 *
 * Los errores duran más que las confirmaciones: un "turno cancelado" se lee
 * de reojo, pero "no se pudo cobrar" hay que entenderlo antes de reintentar.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const show = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      kind === 'error' ? 5200 : 3200,
    );
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, show, dismiss };
}

/**
 * Atajos de teclado globales.
 *
 * Se ignoran mientras se escribe en un campo: si `b` abriera la búsqueda
 * mientras alguien tipea un apellido, sería imposible cargar un cliente.
 */
export function useHotkeys(
  handlers: Record<string, (e: KeyboardEvent) => void>,
  enabled = true,
): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      // Escape funciona siempre: es la salida de emergencia de cualquier
      // estado, incluido un campo de texto abierto por error.
      if (typing && e.key !== 'Escape') return;

      const handler = ref.current[e.key] ?? ref.current[e.key.toLowerCase()];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/**
 * Sesión del usuario.
 *
 * Vive en sessionStorage, no en localStorage: en una recepción con la
 * computadora compartida, cerrar la pestaña debe cerrar la sesión.
 */
export interface Session {
  token: string;
  clubId: string;
  clubName: string;
  userName: string;
  permissions: Set<string>;
}

export function readSession(): Session | null {
  // En el servidor no hay sessionStorage. Next prerenderiza esta página, así
  // que sin esta guarda el build falla con "sessionStorage is not defined".
  if (typeof window === 'undefined') return null;

  const token = sessionStorage.getItem('clubos.token');
  const clubId = sessionStorage.getItem('clubos.club');
  if (!token || !clubId) return null;

  return {
    token,
    clubId,
    clubName: sessionStorage.getItem('clubos.clubName') ?? '',
    userName: sessionStorage.getItem('clubos.user') ?? '',
    permissions: new Set<string>(
      JSON.parse(sessionStorage.getItem('clubos.permissions') ?? '[]') as string[],
    ),
  };
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.clear();
}

export interface UseSessionResult {
  session: Session | null;
  /** Se puso false→true una vez que se leyó (o se intentó leer) sessionStorage. */
  ready: boolean;
  isAuthenticated: boolean;
  /**
   * Sin sesión estamos en modo demostración: es la vidriera de venta del
   * producto y tiene que poder recorrerse entera sin backend. Es un modo
   * explícito, no un efecto secundario de `can()` — quien quiera mostrar todo
   * en modo demo debe chequear `isDemo` a propósito, nunca asumir que
   * `can()` lo hace por él.
   */
  isDemo: boolean;
  can: (permission: string) => boolean;
  logout: () => void;
}

export function useSession(): UseSessionResult {
  // Arranca en null y se lee después de montar: si el estado inicial
  // dependiera de sessionStorage, el HTML del servidor y el del cliente
  // diferirían y React tiraría un error de hidratación.
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(readSession());
    setReady(true);
  }, []);

  const isAuthenticated = session !== null;
  const isDemo = !isAuthenticated;

  const can = useCallback(
    (permission: string) => {
      // Fail-closed: sin sesión no hay permisos que conceder. El modo demo
      // (mostrar todo sin backend) es una decisión de producto explícita —
      // se resuelve con `isDemo` en el llamador, no acá.
      if (!session) return false;
      return session.permissions.has(permission);
    },
    [session],
  );

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  return { session, ready, isAuthenticated, isDemo, can, logout };
}
