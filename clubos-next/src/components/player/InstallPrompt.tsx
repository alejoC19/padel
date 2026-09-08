'use client';

import { useEffect, useState } from 'react';

const DISMISS_KEY = 'clubos.pwa.install.dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari/iOS: no soporta display-mode, expone esto en su lugar.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Banner "Instalar app" del portal del jugador.
 *
 * ---------------------------------------------------------------------------
 * DOS CAMINOS, PORQUE NO HAY UNO SOLO
 * ---------------------------------------------------------------------------
 * Android/Chrome expone `beforeinstallprompt`: lo capturamos y mostramos
 * nuestro propio botón (el navegador NO deja disparar su prompt nativo sin
 * un gesto del usuario primero). iOS Safari NO tiene esa API — Apple no la
 * implementa — así que ahí solo podemos mostrar instrucciones ("Compartir →
 * Agregar a inicio") para que el jugador lo haga a mano.
 *
 * También registra el service worker (ver public/sw.js): sin él, ninguno de
 * los dos navegadores considera la página instalable.
 * ---------------------------------------------------------------------------
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [dismissed, setDismissed] = useState(true); // arranca oculto: se decide en el efecto

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/c/' }).catch(() => {
        // Sin SW no hay instalación, pero el portal sigue funcionando igual.
      });
    }

    let wasDismissed = false;
    try {
      wasDismissed = localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      /* localStorage bloqueado: tratamos como no descartado */
    }

    if (isStandalone()) {
      setDismissed(true);
      return;
    }

    setDismissed(wasDismissed);
    if (isIOS()) setShowIOSHint(true);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    dismiss();
  };

  if (dismissed) return null;
  if (!deferred && !showIOSHint) return null;

  return (
    <div className="install-banner">
      <div className="install-banner-icon">🎾</div>
      <div className="install-banner-text">
        <strong>Instalá ClubOS</strong>
        <span>
          {deferred
            ? 'Accedé más rápido a tus turnos, torneos y el buffet.'
            : 'Tocá el ícono compartir de Safari y elegí "Agregar a inicio".'}
        </span>
      </div>
      {deferred ? (
        <button type="button" className="btn btn-mini btn-primary" onClick={() => void install()}>
          Instalar
        </button>
      ) : (
        <button type="button" className="btn btn-mini btn-secondary" onClick={dismiss}>
          Entendido
        </button>
      )}
      <button type="button" className="install-banner-close" aria-label="Cerrar" onClick={dismiss}>✕</button>
    </div>
  );
}
