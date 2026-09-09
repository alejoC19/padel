import type { Metadata } from 'next';
import Link from 'next/link';
import { HeroAgenda } from '@/components/marketing/HeroAgenda';
import { Ball, PadelDefs } from '@/components/marketing/Art';
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

const FEATURES = [
  { icon: '📅', name: 'Agenda', desc: 'Reservas por cancha, arrastrá y soltá turnos, evitá superposiciones y cobrá en el momento.' },
  { icon: '💵', name: 'Caja', desc: 'Abrí y cerrá turno, registrá movimientos, arqueá por denominación y controlá cada peso.' },
  { icon: '👥', name: 'Clientes', desc: 'Ficha completa, cuenta corriente, historial de turnos y detección de duplicados.' },
  { icon: '🥤', name: 'Buffet', desc: 'Punto de venta rápido, control de stock y cobro integrado a la caja del club.' },
  { icon: '🏆', name: 'Torneos', desc: 'Inscripciones, cuadro automático, carga de resultados y tabla de posiciones.' },
  { icon: '📊', name: 'Reportes', desc: 'Cierre diario, ingresos, ocupación y rentabilidad por cancha en un vistazo.' },
  { icon: '🏦', name: 'Tesorería', desc: 'Disponible hoy, bancos, por cobrar y por pagar, con alertas de vencimientos.' },
];

const BENEFITS = [
  { t: 'Menos trabajo administrativo', d: 'Todo en un solo lugar: dejás de saltar entre planillas y cuadernos.' },
  { t: 'Menos errores', d: 'La caja, la agenda y los clientes se conectan solos. Nada se pierde.' },
  { t: 'Mejor control de caja', d: 'Sabés en todo momento cuánto entró, cuánto salió y cuánto queda.' },
  { t: 'Mejor organización', d: 'La agenda del día clara para recepción, sin turnos pisados.' },
  { t: 'Información centralizada', d: 'Reportes y tesorería al día para decidir con datos reales.' },
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
          <h1 className="lp-h1">
            Administrá tu club de pádel<br />desde un solo lugar.
          </h1>
          <p className="lp-sub">
            Agenda, caja, clientes, buffet, torneos y reportes en una única
            plataforma pensada para clubes de pádel.
          </p>
          <div className="lp-hero-cta">
            <Link href="/crear-club" className="lp-btn lp-btn-primary lp-btn-lg">
              Crear mi club
            </Link>
            <Link href="/agenda" className="lp-btn lp-btn-ghost lp-btn-lg">
              Ver demo
            </Link>
          </div>
          <p className="lp-hero-note">Sin instalar nada. Funciona en la compu de recepción.</p>
        </div>
        <div className="lp-hero-visual">
          <HeroAgenda />
        </div>
      </section>

      {/* FUNCIONALIDADES */}
      <section className="lp-section" id="funcionalidades">
        <div className="lp-section-head">
          <h2 className="lp-h2">Todo tu club en un solo lugar</h2>
          <p className="lp-section-sub">
            Siete módulos que trabajan juntos, sin planillas sueltas.
          </p>
        </div>
        <div className="lp-features">
          {FEATURES.map((f) => (
            <article className="lp-feature" key={f.name}>
              <div className="lp-feature-icon" aria-hidden="true">{f.icon}</div>
              <h3 className="lp-feature-name">{f.name}</h3>
              <p className="lp-feature-desc">{f.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* AGENDA como diferencial */}
      <section className="lp-section lp-agenda-section">
        <div className="lp-section-head">
          <h2 className="lp-h2">La agenda es el corazón del club</h2>
          <p className="lp-section-sub">
            Arrastrá turnos, evitá superposiciones y cobrá sin salir de la pantalla.
          </p>
        </div>
        <div className="lp-agenda-demo">
          <HeroAgenda />
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
              <div className="lp-benefit-check" aria-hidden="true">✓</div>
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
