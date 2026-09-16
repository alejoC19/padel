'use client';

import { useState } from 'react';

/**
 * Mockup del lado club: ventana de escritorio con dos pestañas reales,
 * Agenda y Tesorería.
 *
 * La agenda que se mostraba antes acá (grilla de 4 canchas × franjas fijas,
 * ver git blame de HeroAgenda) dejó de existir en el producto el día que la
 * agenda pasó a ser "una cancha por vez, turnos como tarjetas" (AgendaBoard,
 * ver clubos-next/src/components/AgendaBoard.tsx) — la landing quedó
 * vendiendo una pantalla vieja. Esta reproduce la real: una tira de estado
 * por cancha arriba, y abajo los turnos del día de la cancha elegida como
 * bloques continuos (un hueco libre de 90 min es UNA tarjeta "Disponible",
 * no tres de 30).
 *
 * La pestaña de Tesorería existía en la lista de funcionalidades pero nunca
 * se veía en acción — es la parte que un dueño de club googlea primero
 * ("¿me alcanza para pagar el viernes?").
 *
 * Todo esto va adentro de la pantalla de una MacBook real (devices.css —
 * ver styles/devices.css): una ventana de navegador sola, flotando sobre
 * fondo oscuro, no se lee como "así lo uso en mi compu" sin el contexto
 * físico de la notebook alrededor.
 */

const COURTS = [
  { name: 'Cancha 1', color: '#3B82F6', status: 'Ocupada · hasta 19:30', tone: 'busy' as const },
  { name: 'Cancha 2', color: '#00C46A', status: 'Libre · hasta las 20:00', tone: 'free' as const, active: true },
  { name: 'Cancha 3', color: '#F5A524', status: 'Libre todo el día', tone: 'free' as const },
  { name: 'Cancha 4', color: '#A855F7', status: 'Bloqueada', tone: 'block' as const },
];

const SLOTS = [
  { kind: 'booked' as const, time: '14:00 – 15:30', name: 'José González', tag: 'A cobrar', tone: 'warn' as const },
  { kind: 'free' as const, time: '15:30 – 17:00', sub: '90 min · hasta 4 jugadores' },
  { kind: 'booked' as const, time: '17:00 – 18:00', name: 'Escuela · Nivel 2', tag: 'Pagada', tone: 'ok' as const },
  { kind: 'free' as const, time: '18:00 – 20:00', sub: '120 min · hasta 4 jugadores' },
];

const TREASURY_STATS = [
  { label: 'Disponible hoy', value: '$1.284.500', tone: 'ok' as const },
  { label: 'En bancos', value: '$3.910.200', tone: 'ok' as const },
  { label: 'Por cobrar', value: '$186.000', tone: 'warn' as const },
  { label: 'Por pagar (7 días)', value: '$540.000', tone: 'danger' as const },
];

const TREASURY_ROWS = [
  { concept: 'Alquiler del predio', due: 'Vence en 2 días', amount: '$320.000' },
  { concept: 'Proveedor de buffet', due: 'Vence en 5 días', amount: '$140.000' },
  { concept: 'Service de canchas', due: 'Vence en 7 días', amount: '$80.000' },
];

export function DesktopMock() {
  const [tab, setTab] = useState<'agenda' | 'tesoreria'>('agenda');

  return (
    <div className="lp-macbook-wrap">
    <div className="marvel-device macbook lp-macbook-device">
      <div className="top-bar" />
      <div className="camera" />
      <div className="screen">
      <div className="lp-window">
      <div className="lp-demo-bar">
        <span className="lp-dot" style={{ background: '#F26D6D' }} />
        <span className="lp-dot" style={{ background: '#F5A524' }} />
        <span className="lp-dot" style={{ background: 'var(--turf)' }} />
        <div className="lp-window-tabs" role="tablist" aria-label="Secciones del club">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'agenda'}
            className={`lp-window-tab${tab === 'agenda' ? ' is-active' : ''}`}
            onClick={() => setTab('agenda')}
          >
            Agenda
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'tesoreria'}
            className={`lp-window-tab${tab === 'tesoreria' ? ' is-active' : ''}`}
            onClick={() => setTab('tesoreria')}
          >
            Tesorería
          </button>
        </div>
        <span className="lp-demo-live"><span className="lp-pulse" />en vivo</span>
      </div>

      {tab === 'agenda' ? (
        <div className="lp-window-body">
          <div className="lp-mini-strip" role="tablist" aria-label="Estado de las canchas ahora">
            {COURTS.map((c) => (
              <div className={`lp-mini-chip is-${c.tone}${c.active ? ' is-selected' : ''}`} key={c.name}>
                <span className="lp-mini-chip-dot" style={{ background: c.color }} />
                <span className="lp-mini-chip-body">
                  <span className="lp-mini-chip-name">{c.name}</span>
                  <span className="lp-mini-chip-status">{c.status}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="lp-mini-list">
            {SLOTS.map((s) => (
              s.kind === 'free' ? (
                <div className="lp-mini-card is-free" key={s.time}>
                  <span className="lp-mini-card-time">{s.time}</span>
                  <span className="lp-mini-card-state">Disponible</span>
                  <span className="lp-mini-card-sub">{s.sub}</span>
                </div>
              ) : (
                <div className={`lp-mini-card is-${s.tone}`} key={s.time}>
                  <span className="lp-mini-card-time">{s.time}</span>
                  <span className="lp-mini-card-state">{s.tag}</span>
                  <span className="lp-mini-card-sub">{s.name}</span>
                </div>
              )
            ))}
          </div>
        </div>
      ) : (
        <div className="lp-window-body">
          <div className="lp-treasury-grid">
            {TREASURY_STATS.map((s) => (
              <div className={`lp-treasury-stat is-${s.tone}`} key={s.label}>
                <span className="lp-treasury-stat-value">{s.value}</span>
                <span className="lp-treasury-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
          <div className="lp-treasury-list">
            <span className="lp-treasury-list-head">Próximos vencimientos</span>
            {TREASURY_ROWS.map((r) => (
              <div className="lp-treasury-row" key={r.concept}>
                <span className="lp-treasury-row-concept">{r.concept}</span>
                <span className="lp-treasury-row-due">{r.due}</span>
                <span className="lp-treasury-row-amount">{r.amount}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>
      </div>
      <div className="bottom-bar" />
    </div>
    </div>
  );
}
