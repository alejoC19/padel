/**
 * Gráficos de pádel dibujados en SVG.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ NO SON IMÁGENES
 * ---------------------------------------------------------------------------
 * Una landing que vende no puede depender de que un CDN de terceros responda:
 * si falla, quedan cuadros rotos justo cuando alguien la está evaluando.
 *
 * Además pesan kilobytes en vez de megabytes, se colorean con las mismas
 * variables del resto del diseño, y se animan.
 *
 * Los símbolos se definen una vez y se instancian con <use>: la pelota
 * aparece nueve veces en la página y el trazado viaja una sola.
 * ---------------------------------------------------------------------------
 */

/** Definiciones compartidas. Se monta una vez, arriba del árbol. */
export function PadelDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <radialGradient id="ballGrad" cx="35%" cy="30%">
          <stop offset="0%" stopColor="#EDF56B" />
          <stop offset="55%" stopColor="#D8E63C" />
          <stop offset="100%" stopColor="#9FAD26" />
        </radialGradient>
        <linearGradient id="racketFace" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2B3A47" />
          <stop offset="100%" stopColor="#18242E" />
        </linearGradient>
        <linearGradient id="courtFloor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1D6FA5" />
          <stop offset="100%" stopColor="#0E3F60" />
        </linearGradient>

        {/* Pelota: el amarillo verdoso real y las dos costuras curvas.
            Sin las costuras es una bola amarilla cualquiera. */}
        <symbol id="pd-ball" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="46" fill="url(#ballGrad)" />
          <path d="M14 22c16 14 16 42 0 56" fill="none" stroke="#fff"
                strokeWidth="4.5" strokeLinecap="round" opacity=".92" />
          <path d="M86 22c-16 14-16 42 0 56" fill="none" stroke="#fff"
                strokeWidth="4.5" strokeLinecap="round" opacity=".92" />
          <ellipse cx="34" cy="30" rx="15" ry="11" fill="#fff" opacity=".22" />
        </symbol>

        {/* Paleta: forma de lágrima con el patrón de agujeros, que es su
            marca visual inconfundible. */}
        <symbol id="pd-racket" viewBox="0 0 120 200">
          <rect x="52" y="132" width="16" height="56" rx="7" fill="#2B3A47"
                stroke="#3E515F" strokeWidth="1.5" />
          <g stroke="#4A6070" strokeWidth="1.4" opacity=".85">
            <path d="M52 142h16M52 152h16M52 162h16M52 172h16M52 182h16" />
          </g>
          <path d="M46 128q14 10 28 0v10q-14 8-28 0z" fill="#2B3A47" />
          <path d="M60 8c30 0 52 26 52 60 0 30-22 62-52 62S8 98 8 68C8 34 30 8 60 8z"
                fill="url(#racketFace)" stroke="#4A6070" strokeWidth="2.5" />
          <g fill="#0B0E12" opacity=".62">
            {[
              [60, 34], [42, 42], [78, 42], [30, 58], [60, 54], [90, 58],
              [42, 70], [78, 70], [30, 86], [60, 82], [90, 86],
              [42, 98], [78, 98], [60, 110],
            ].map(([cx, cy]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="4" />
            ))}
          </g>
          <path d="M60 8c30 0 52 26 52 60" fill="none" stroke="#00C46A"
                strokeWidth="3" strokeLinecap="round" opacity=".55" />
        </symbol>
      </defs>
    </svg>
  );
}

export function Ball({ size = 40, float }: { size?: number; float?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 100 100" aria-hidden="true"
      className={float !== undefined ? 'lp-float' : undefined}
      style={float !== undefined ? { animationDelay: float } : undefined}
    >
      <use href="#pd-ball" />
    </svg>
  );
}

export function Racket({ width = 66, height = 110, rotate = 0 }: {
  width?: number; height?: number; rotate?: number;
}) {
  return (
    <svg
      width={width} height={height} viewBox="0 0 120 200" aria-hidden="true"
      style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
    >
      <use href="#pd-racket" />
    </svg>
  );
}

/** Tubo de tres pelotas. */
export function BallTube() {
  return (
    <svg width="92" height="112" viewBox="0 0 120 130" aria-hidden="true">
      <rect x="30" y="8" width="60" height="116" rx="12"
            fill="rgba(255,255,255,.07)" stroke="rgba(200,225,240,.35)" strokeWidth="2" />
      <svg x="34" y="16" width="52" height="52" viewBox="0 0 100 100"><use href="#pd-ball" /></svg>
      <svg x="34" y="46" width="52" height="52" viewBox="0 0 100 100"><use href="#pd-ball" /></svg>
      <svg x="34" y="70" width="52" height="52" viewBox="0 0 100 100"><use href="#pd-ball" /></svg>
      <rect x="30" y="8" width="60" height="14" rx="6" fill="rgba(0,196,106,.5)" />
    </svg>
  );
}

/**
 * Cancha en perspectiva con la pelota picando y la paleta acompañando.
 *
 * Las animaciones comparten un ciclo de 2,6 segundos para que el golpe caiga
 * cuando la pelota está arriba. Si fueran independientes se desincronizarían
 * y se vería como dos cosas sueltas en vez de una jugada.
 */
export function CourtScene() {
  return (
    <svg
      className="lp-court" viewBox="0 0 420 340" role="img"
      aria-label="Cancha de pádel con una pelota picando y una paleta golpeando"
    >
      <path d="M60 300 L360 300 L318 120 L102 120 Z" fill="url(#courtFloor)" />
      <g stroke="#8FD3F4" strokeWidth="2" opacity=".5" fill="none">
        <path d="M102 120 L318 120" />
        <path d="M84 220 L336 220" />
        <path d="M210 220 L210 300" />
      </g>
      <path d="M102 120 L102 62 L318 62 L318 120" fill="rgba(160,215,245,.08)"
            stroke="#8FD3F4" strokeWidth="1.6" opacity=".4" />
      <g stroke="#8FD3F4" strokeWidth=".8" opacity=".2">
        <path d="M156 62v58M210 62v58M264 62v58" />
      </g>

      {/* red */}
      <rect x="84" y="196" width="252" height="26" fill="#0B1B26" opacity=".5" />
      <g stroke="#C8D6E0" strokeWidth=".7" opacity=".4">
        <path d="M100 196v26M116 196v26M132 196v26M148 196v26M164 196v26M180 196v26M196 196v26M212 196v26M228 196v26M244 196v26M260 196v26M276 196v26M292 196v26M308 196v26M324 196v26" />
        <path d="M84 204h252M84 212h252" />
      </g>
      <path d="M84 194h252" stroke="#EEF1F4" strokeWidth="3" opacity=".85" />

      <ellipse className="lp-ball-shadow" cx="286" cy="274" rx="16" ry="5"
               fill="#04121C" opacity=".35" />
      <g className="lp-ball-bounce">
        <svg x="270" y="250" width="32" height="32" viewBox="0 0 100 100" overflow="visible">
          <g className="lp-ball-seam"><use href="#pd-ball" /></g>
        </svg>
      </g>
      <g className="lp-racket-swing">
        <svg x="94" y="152" width="94" height="156" viewBox="0 0 120 200" overflow="visible">
          <use href="#pd-racket" />
        </svg>
      </g>
    </svg>
  );
}

/**
 * Cuaderno de reservas con turnos tachados.
 *
 * Es el problema dibujado: renglones, tachones, signos de pregunta donde no
 * se sabe si pagaron, y un turno marcado como repetido. Una foto genérica de
 * cancha no comunica nada de eso.
 */
export function NotebookScene() {
  const lines = [
    '19:00 — Gonzalez C2',
    '20:30 — Martina C1',
    '21:00 — Perez ...?',
    '18:00 — Diego (pagó?)',
    '20:30 — Sosa C1',
    '19:30 — clase',
  ];

  return (
    <svg
      className="lp-notebook" viewBox="0 0 380 300" role="img"
      aria-label="Cuaderno de reservas con anotaciones tachadas y un turno repetido"
    >
      <rect x="40" y="20" width="300" height="260" rx="6" fill="#F2EFE4" />
      <rect x="40" y="20" width="300" height="260" rx="6" fill="none"
            stroke="#C9C2AE" strokeWidth="1.5" />
      <g stroke="#8A93A0" strokeWidth="3" fill="none">
        <path d="M40 44h-14M40 76h-14M40 108h-14M40 140h-14M40 172h-14M40 204h-14M40 236h-14" />
      </g>
      <g stroke="#D5CDB8" strokeWidth="1">
        <path d="M60 68h260M60 100h260M60 132h260M60 164h260M60 196h260M60 228h260" />
      </g>
      <path d="M76 30v240" stroke="#E0A9A9" strokeWidth="1.2" />

      <g fontSize="13" fill="#2E3B47" fontFamily="Inter Tight, sans-serif">
        {lines.map((t, i) => (
          <text key={t} x="88" y={62 + i * 32}>{t}</text>
        ))}
      </g>

      <path d="M84 88 L246 98" stroke="#C8443E" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M84 96 L246 88" stroke="#C8443E" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M84 184 L236 192" stroke="#C8443E" strokeWidth="2.2" strokeLinecap="round" />

      <rect x="252" y="80" width="76" height="26" rx="5" fill="#C8443E" opacity=".15" />
      <text x="260" y="97" fontSize="11" fontWeight="700" fill="#C8443E"
            fontFamily="Inter Tight, sans-serif">¡repetido!</text>
      <text x="300" y="126" fontSize="20" fill="#C8443E" opacity=".7">?</text>
      <text x="288" y="158" fontSize="20" fill="#C8443E" opacity=".7">?</text>

      <g transform="translate(288,224)">
        <ellipse cx="20" cy="42" rx="19" ry="5" fill="#000" opacity=".16" />
        <svg x="0" y="0" width="40" height="40" viewBox="0 0 100 100"><use href="#pd-ball" /></svg>
      </g>
    </svg>
  );
}
