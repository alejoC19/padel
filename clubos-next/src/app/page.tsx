import type { Metadata } from 'next';
import Link from 'next/link';
import { PhoneBookingDemo } from '@/components/marketing/PhoneBookingDemo';
import { DesktopMock } from '@/components/marketing/DesktopMock';
import { Ball, NotebookScene, PadelDefs } from '@/components/marketing/Art';
import { ModuleIcon, type ModuleIconName } from '@/components/marketing/ModuleIcon';
import '@/styles/devices.css';
import '@/styles/landing.css';

export const metadata: Metadata = {
  title: 'ClubOS — El sistema de gestión para tu club de pádel',
  description:
    'Agenda, caja, clientes, buffet, torneos, tesorería y reportes en una sola plataforma. Administrá tu club de pádel desde un solo lugar.',
  robots: 'index, follow',
  openGraph: {
    title: 'ClubOS — Gestión para clubes de pádel',
    description:
      'Agenda, caja, clientes, buffet, torneos y reportes en una única plataforma.',
    type: 'website',
    locale: 'es_AR',
  },
};

const FEATURES: { icon: ModuleIconName; name: string; desc: string }[] = [
  { icon: 'agenda', name: 'Agenda', desc: 'Reservas por cancha, arrastrá y soltá turnos, evitá superposiciones y cobrá en el momento.' },
  { icon: 'caja', name: 'Caja', desc: 'Abrí y cerrá turno, registrá movimientos, arqueá por denominación y controlá cada peso.' },
  { icon: 'clientes', name: 'Clientes', desc: 'Ficha completa, cuenta corriente, historial de turnos y detección de duplicados.' },
  { icon: 'buffet', name: 'Buffet', desc: 'Punto de venta rápido, control de stock y cobro integrado a la caja del club.' },
  { icon: 'torneos', name: 'Torneos', desc: 'Inscripciones, cuadro automático, carga de resultados y tabla de posiciones.' },
  { icon: 'reportes', name: 'Reportes', desc: 'Cierre diario, ingresos, ocupación y rentabilidad por cancha en un vistazo.' },
  { icon: 'tesoreria', name: 'Tesorería', desc: 'Disponible hoy, bancos, por cobrar y por pagar, con alertas de vencimientos.' },
];

const BENEFITS = [
  { t: 'Menos trabajo administrativo', d: 'Todo en un solo lugar: dejás de saltar entre planillas y cuadernos.' },
  { t: 'Menos errores', d: 'La caja, la agenda y los clientes se conectan solos. Nada se pierde.' },
  { t: 'Mejor control de caja', d: 'Sabés en todo momento cuánto entró, cuánto salió y cuánto queda.' },
  { t: 'Mejor organización', d: 'La agenda del día clara para recepción, sin turnos pisados.' },
  { t: 'Información centralizada', d: 'Reportes y tesorería al día para decidir con datos reales.' },
];

const IMPACT = [
  { num: '7', label: 'módulos trabajando juntos: agenda, caja, clientes, buffet, torneos, reportes y tesorería.' },
  { num: '24/7', label: 'tus jugadores reservan solos desde el celular, sin llamarte.' },
  { num: '0', label: 'planillas sueltas ni cuadernos: todo lo que pasa en el club queda registrado.' },
  { num: '100%', label: 'de la caja controlada, en todo momento, no solo al cierre.' },
];

const PROBLEMS = [
  { t: 'El cuaderno se llena de tachones', d: 'Turnos repetidos, letra que no se entiende, y nadie sabe si ese cliente ya pagó.' },
  { t: 'El grupo de WhatsApp no escala', d: 'Cuando el club crece, coordinar reservas a mano se vuelve un segundo trabajo.' },
  { t: 'La plata se pierde en el camino', d: 'Sin caja centralizada, cerrar el día es adivinar cuánto entró de verdad.' },
];

export default function LandingPage() {
  return (
    <div className="lp">
      <PadelDefs />

      {/* NAVBAR */}
      <header className="lp-nav">
        <Link href="/" className="lp-brand">
          <Ball size={30} />
          <span>ClubOS</span>
        </Link>
        <nav className="lp-nav-links">
          <a href="#producto">Producto</a>
          <a href="#funcionalidades">Funcionalidades</a>
          <a href="#para-clubes">Para clubes</a>
        </nav>
        <div className="lp-nav-cta">
          <Link href="/jugador" className="lp-link lp-link-player">Soy jugador</Link>
          <Link href="/entrar" className="lp-link lp-link-signin">Iniciar sesión</Link>
          <Link href="/crear-club" className="lp-btn lp-btn-primary">Crear mi club</Link>
        </div>
      </header>

      {/* HERO */}
      <section className="lp-hero" id="producto">
        <div className="lp-hero-copy">
          <span className="lp-eyebrow">Gestión para clubes de pádel</span>
          <h1 className="lp-h1">
            Tus jugadores <span className="lp-accent">reservan solos</span>.<br />
            Vos manejás todo el club.
          </h1>
          <p className="lp-sub">
            Tu cliente saca el turno desde el celular, sin llamarte. Vos ves
            la agenda, la caja, los clientes, el buffet, los torneos y la
            tesorería del club en una única plataforma.
          </p>
          <div className="lp-hero-cta">
            <Link href="/crear-club" className="lp-btn lp-btn-primary lp-btn-lg">
              Crear mi club
            </Link>
            <Link href="/agenda" className="lp-btn lp-btn-ghost lp-btn-lg">
              Ver demo
            </Link>
          </div>
          <p className="lp-hero-note">Sin instalar nada. Funciona en la compu de recepción y en el celular de tu cliente.</p>
        </div>
        <div className="lp-hero-visual">
          <div className="lp-hero-blob" aria-hidden="true" />
          <PhoneBookingDemo />
        </div>
      </section>

      {/* IMPACTO — vender a primera vista, con números grandes */}
      <section className="lp-impact">
        <div className="lp-impact-grid">
          {IMPACT.map((s) => (
            <div className="lp-impact-card" key={s.label}>
              <span className="lp-impact-num">{s.num}</span>
              <span className="lp-impact-label">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* EL PROBLEMA */}
      <section className="lp-problem">
        <div className="lp-problem-visual">
          <NotebookScene />
        </div>
        <div>
          <span className="lp-eyebrow">El problema</span>
          <h2 className="lp-h2" style={{ marginBottom: 8 }}>
            El cuaderno y el grupo de <span className="lp-accent">WhatsApp</span> ya no alcanzan
          </h2>
          <p className="lp-section-sub" style={{ textAlign: 'left', margin: 0 }}>
            Así se maneja hoy la mayoría de los clubes — hasta que un turno
            pisado o una caja que no cierra les hace perder un cliente.
          </p>
          <div className="lp-problem-list">
            {PROBLEMS.map((p) => (
              <div className="lp-problem-item" key={p.t}>
                <span className="lp-problem-item-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  </svg>
                </span>
                <div>
                  <h3 className="lp-problem-item-title">{p.t}</h3>
                  <p className="lp-problem-item-desc">{p.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FUNCIONALIDADES */}
      <section className="lp-section" id="funcionalidades">
        <div className="lp-section-head">
          <span className="lp-eyebrow" style={{ justifyContent: 'center' }}>La solución</span>
          <h2 className="lp-h2">Todo tu club en un solo lugar</h2>
          <p className="lp-section-sub">
            Siete módulos que trabajan juntos, sin planillas sueltas.
          </p>
        </div>
        <div className="lp-features">
          {FEATURES.map((f) => (
            <article className="lp-feature" key={f.name}>
              <div className="lp-feature-icon"><ModuleIcon name={f.icon} /></div>
              <h3 className="lp-feature-name">{f.name}</h3>
              <p className="lp-feature-desc">{f.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* AGENDA + TESORERÍA como diferencial */}
      <section className="lp-section lp-agenda-section">
        <div className="lp-section-head">
          <h2 className="lp-h2">Así lo ves vos, desde la compu del club</h2>
          <p className="lp-section-sub">
            La agenda del día y cuánta plata hay — hoy, en el banco y lo que
            viene — sin saltar entre planillas.
          </p>
        </div>
        <div className="lp-agenda-demo">
          <DesktopMock />
        </div>
      </section>

      {/* BENEFICIOS */}
      <section className="lp-section" id="para-clubes">
        <div className="lp-section-head">
          <h2 className="lp-h2">Por qué los clubes eligen ClubOS</h2>
        </div>
        <div className="lp-benefits">
          {BENEFITS.map((b) => (
            <div className="lp-benefit" key={b.t}>
              <div className="lp-benefit-check" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div>
                <h3 className="lp-benefit-title">{b.t}</h3>
                <p className="lp-benefit-desc">{b.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="lp-final">
        <h2 className="lp-h2">Empezá a ordenar tu club hoy</h2>
        <p className="lp-section-sub">Creá tu club en minutos y probalo con datos reales.</p>
        <Link href="/crear-club" className="lp-btn lp-btn-primary lp-btn-lg">
          Crear mi club
        </Link>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer">
        <div className="lp-brand">
          <Ball size={24} />
          <span>ClubOS</span>
        </div>
        <p className="lp-footer-note">
          Sistema de gestión para clubes de pádel.
        </p>
        <div className="lp-footer-links">
          <Link href="/entrar">Iniciar sesión</Link>
          <Link href="/crear-club">Crear mi club</Link>
        </div>
      </footer>
    </div>
  );
}
