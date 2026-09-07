/**
 * Agenda de demostración del hero.
 *
 * El argumento de venta de un ERP es ver el software funcionando, no una foto
 * de cancha con un titular encima. Se construye desde datos, así que si mañana
 * cambia el diseño del bloque en el producto, cambia acá también.
 *
 * Es un server component: la animación de entrada es CSS puro, no necesita JS.
 */

const HOURS = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30'];

const COURTS = [
  { name: 'Cancha 1', color: '#3B82F6' },
  { name: 'Cancha 2', color: '#00C46A' },
  { name: 'Cancha 3', color: '#F5A524' },
  { name: 'Cancha 4', color: '#A855F7' },
];

interface Slot {
  col: number; row: number; span: number;
  kind: 'ok' | 'pay' | 'due' | 'les' | 'mnt';
  time: string; name: string; warn?: string;
}

const BOOKINGS: Slot[] = [
  { col: 0, row: 0, span: 3, kind: 'pay', time: '18:00', name: 'Martina Ferreyra' },
  { col: 0, row: 4, span: 3, kind: 'ok',  time: '20:00', name: 'Lucía Bianchi' },
  { col: 1, row: 1, span: 3, kind: 'due', time: '18:30', name: 'José González', warn: 'falta $24.000' },
  { col: 1, row: 5, span: 3, kind: 'ok',  time: '20:30', name: 'Diego Sosa' },
  { col: 2, row: 0, span: 4, kind: 'les', time: '18:00', name: 'Escuela · Nivel 2' },
  { col: 2, row: 5, span: 3, kind: 'ok',  time: '20:30', name: 'Ana Rodríguez' },
  { col: 3, row: 2, span: 4, kind: 'mnt', time: '19:00', name: 'Mantenimiento' },
  { col: 3, row: 6, span: 2, kind: 'pay', time: '21:00', name: 'J. C. Pérez' },
];

export function HeroAgenda() {
  // Mapa de celdas ocupadas: las filas de continuación se saltean para que
  // el bloque ocupe su span sin que se dibuje una celda vacía encima.
  const occupied = new Map<string, 'start' | 'cont'>();
  for (const b of BOOKINGS) {
    for (let r = b.row; r < b.row + b.span; r++) {
      occupied.set(`${b.col}-${r}`, r === b.row ? 'start' : 'cont');
    }
  }

  return (
    <div className="lp-demo">
      <div className="lp-demo-bar">
        <span className="lp-dot" style={{ background: '#F26D6D' }} />
        <span className="lp-dot" style={{ background: '#F5A524' }} />
        <span className="lp-dot" style={{ background: 'var(--turf)' }} />
        <span className="lp-demo-label">Agenda · miércoles 22 de julio</span>
        <span className="lp-demo-live"><span className="lp-pulse" />en vivo</span>
      </div>

      <div className="lp-agenda">
        <div className="lp-ag-head" />
        {COURTS.map((c, i) => (
          <div className={`lp-ag-head${i === COURTS.length - 1 ? ' is-last' : ''}`} key={c.name}>
            <span className="lp-ag-swatch" style={{ background: c.color }} />
            {c.name}
          </div>
        ))}

        {HOURS.map((h, row) => (
          <HourRow key={h} hour={h} row={row} occupied={occupied} />
        ))}
      </div>
    </div>
  );
}

function HourRow({ hour, row, occupied }: {
  hour: string; row: number; occupied: Map<string, 'start' | 'cont'>;
}) {
  return (
    <>
      <div className="lp-ag-time">{hour}</div>
      {COURTS.map((_, col) => {
        const last = col === COURTS.length - 1 ? ' is-last' : '';
        if (occupied.get(`${col}-${row}`) === 'cont') {
          return <div className={`lp-ag-cell${last}`} key={col} />;
        }
        const bk = BOOKINGS.find((b) => b.col === col && b.row === row);
        if (!bk) {
          return (
            <div className={`lp-ag-cell${last}`} key={col}>
              <span className="lp-free">+</span>
            </div>
          );
        }
        return (
          <div
            className={`lp-ag-cell${last}`}
            key={col}
            style={{ gridRow: `span ${bk.span}`, height: 'auto' }}
          >
            <div
              className={`lp-bk is-${bk.kind}`}
              style={{ animationDelay: `${col * 80 + row * 40}ms` }}
            >
              <span className="lp-bk-h">{bk.time}</span>
              <span className="lp-bk-n">{bk.name}</span>
              {bk.warn && <span className="lp-bk-w">{bk.warn}</span>}
            </div>
          </div>
        );
      })}
    </>
  );
}
