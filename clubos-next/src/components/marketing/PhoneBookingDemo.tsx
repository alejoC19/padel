/**
 * Mockup del lado jugador: un teléfono real sacando un turno.
 *
 * La landing vieja solo mostraba la agenda del club (la vista del dueño). Un
 * visitante que nunca usó el producto no tiene forma de saber cómo reserva
 * su cliente — que es, en la práctica, el argumento de venta más fuerte
 * ("mis jugadores reservan solos, no me llaman por WhatsApp"). Server
 * component: toda la animación (el tap en el horario y el cartel de
 * confirmación) es CSS puro.
 */

const DAYS = [
  { dow: 'mar', num: '21' },
  { dow: 'mié', num: '22', active: true },
  { dow: 'jue', num: '23' },
  { dow: 'vie', num: '24' },
  { dow: 'sáb', num: '25' },
];

const SLOTS = ['18:00', '19:30', '21:00'];

export function PhoneBookingDemo() {
  return (
    <div className="lp-phone-wrap">
      <div className="lp-phone">
        <div className="lp-phone-notch" />
        <div className="lp-phone-screen">
          <div className="lp-phone-statusbar">
            <span>9:41</span>
            <span className="lp-phone-statusbar-icons">
              <svg width="14" height="10" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
                <rect x="0" y="7" width="3" height="5" rx="0.5" />
                <rect x="4.5" y="5" width="3" height="7" rx="0.5" />
                <rect x="9" y="2" width="3" height="10" rx="0.5" />
                <rect x="13" y="0" width="3" height="12" rx="0.5" />
              </svg>
            </span>
          </div>

          <div className="lp-phone-app-head">
            <span className="lp-phone-club-badge">P</span>
            <div>
              <span className="lp-phone-club-name">Padel Norte</span>
              <span className="lp-phone-club-tag">Reservá tu cancha</span>
            </div>
          </div>

          <div className="lp-date-strip">
            {DAYS.map((d) => (
              <div className={`lp-date-chip${d.active ? ' is-selected' : ''}`} key={d.num}>
                <span className="lp-date-chip-dow">{d.dow}</span>
                <span className="lp-date-chip-num">{d.num}</span>
              </div>
            ))}
          </div>

          <div className="lp-dur-toggle">
            <span className="lp-dur-btn">60 min</span>
            <span className="lp-dur-btn is-on">90 min</span>
            <span className="lp-dur-btn">120 min</span>
          </div>

          <div className="lp-court-block">
            <div className="lp-court-block-head">
              <span className="lp-court-block-dot" />
              Cancha 2 · Techada
            </div>
            <div className="lp-slot-row">
              {SLOTS.map((s, i) => (
                <span className={`lp-slot-pill${i === 1 ? ' is-tapped' : ''}`} key={s}>
                  {s}
                </span>
              ))}
            </div>
          </div>

          <div className="lp-court-block lp-court-block-dim">
            <div className="lp-court-block-head">
              <span className="lp-court-block-dot" style={{ background: '#F5A524' }} />
              Cancha 3 · Descubierta
            </div>
            <div className="lp-slot-row">
              <span className="lp-slot-pill">18:30</span>
              <span className="lp-slot-pill">20:00</span>
            </div>
          </div>

          <div className="lp-phone-cta">
            <div className="lp-toast-confirm">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              Turno confirmado · miércoles 19:30
            </div>
            <span className="lp-phone-cta-btn">Reservar</span>
          </div>
        </div>
      </div>
    </div>
  );
}
