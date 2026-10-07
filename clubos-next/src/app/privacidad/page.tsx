import Link from 'next/link';
import { Ball } from '@/components/marketing/Art';

const WHATSAPP_HREF = 'https://wa.me/542273418842';

export default function PrivacidadPage() {
  return (
    <div className="lp legal">
      <header className="lp-nav">
        <Link href="/" className="lp-brand">
          <Ball size={30} />
          <span>PadelApp2</span>
        </Link>
        <nav className="lp-nav-links">
          <Link href="/">Volver al inicio</Link>
        </nav>
      </header>

      <main className="legal-body">
        <h1>Política de privacidad</h1>
        <p className="legal-updated">Última actualización: octubre de 2026.</p>

        <p>
          Esta política explica qué datos recopila PadelApp2, para qué los usa y cómo
          podés ejercer tus derechos sobre ellos. Aplica tanto si usás la app como
          jugador (reservando canchas en un club) como si sos parte del staff de un
          club que usa PadelApp2 para administrarse.
        </p>

        <h2>Qué datos recopilamos</h2>
        <p>Según cómo uses la plataforma:</p>
        <ul>
          <li>
            <strong>Si jugás</strong> (portal del jugador): nombre, apellido, email y
            contraseña para crear tu cuenta. Opcionalmente, teléfono. Las reservas que
            hacés (club, cancha, horario) quedan asociadas a tu cuenta para mostrarte
            &quot;Mis reservas&quot;.
          </li>
          <li>
            <strong>Si sos staff de un club</strong>: nombre, apellido, email y
            contraseña. El club que te invita puede además cargar datos de contacto de
            sus clientes (nombre, email, teléfono, documento) como parte de su ficha
            de socios — esos datos los administra el club, no PadelApp2 directamente.
          </li>
          <li>
            <strong>Pagos</strong>: cuando un cobro se procesa por Mercado Pago,
            PadelApp2 guarda el monto, el estado y un identificador de la transacción
            que nos da Mercado Pago. <strong>Nunca</strong> recibimos ni almacenamos
            el número de tu tarjeta — eso lo maneja Mercado Pago directamente.
          </li>
          <li>
            <strong>Datos técnicos</strong>: al iniciar sesión guardamos la fecha,
            dirección IP y navegador usados, para poder detectar accesos indebidos y
            para que el staff de un club pueda ver quién hizo qué cambio (registro de
            auditoría).
          </li>
        </ul>

        <h2>Para qué los usamos</h2>
        <ul>
          <li>Darte acceso a tu cuenta y a tus reservas.</li>
          <li>Que el club pueda gestionar sus canchas, clientes, caja y cobros.</li>
          <li>Mandarte los emails necesarios para operar (confirmación de reserva, recuperar contraseña, invitación a un club).</li>
          <li>Prevenir fraude y accesos no autorizados.</li>
        </ul>
        <p>No usamos tus datos para publicidad ni se los vendemos a nadie.</p>

        <h2>Con quién compartimos datos</h2>
        <p>Solo con los proveedores que hacen posible el servicio:</p>
        <ul>
          <li><strong>Mercado Pago</strong>, para procesar cobros.</li>
          <li><strong>Resend</strong>, para enviar los emails transaccionales de la plataforma.</li>
          <li><strong>Railway</strong> y <strong>Vercel</strong>, que alojan el backend y el sitio.</li>
        </ul>
        <p>Ninguno de estos proveedores puede usar tus datos para fines propios.</p>

        <h2>Cuánto tiempo conservamos los datos</h2>
        <p>
          Mientras tu cuenta esté activa. Si la das de baja o el club deja de usar la
          plataforma, los datos se conservan el tiempo mínimo exigido por obligaciones
          impositivas y contables (comprobantes de pago), y se eliminan o anonimizan
          después de ese plazo.
        </p>

        <h2>Seguridad</h2>
        <p>
          Las contraseñas nunca se guardan en texto plano — se almacenan con un hash
          criptográfico. Toda la comunicación entre tu navegador y nuestros
          servidores viaja cifrada (HTTPS).
        </p>

        <h2>Tus derechos</h2>
        <p>
          Bajo la Ley 25.326 de Protección de Datos Personales, tenés derecho a
          acceder, rectificar o solicitar la supresión de tus datos personales.
          Escribinos por el contacto de abajo y lo resolvemos. La autoridad de
          control es la Agencia de Acceso a la Información Pública
          (www.argentina.gob.ar/aaip).
        </p>

        <h2>Cookies y almacenamiento local</h2>
        <p>
          Usamos <code>localStorage</code> y <code>sessionStorage</code> del
          navegador para mantener tu sesión iniciada y recordar tu preferencia de
          modo claro/oscuro. No usamos cookies de rastreo ni de terceros con fines
          publicitarios.
        </p>

        <h2>Cambios a esta política</h2>
        <p>
          Si la actualizamos de forma relevante, lo vamos a avisar en esta misma
          página.
        </p>

        <h2>Contacto</h2>
        <p>
          Para cualquier consulta sobre tus datos, escribinos por{' '}
          <a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">WhatsApp</a>.
        </p>
      </main>

      <footer className="lp-footer">
        <div className="lp-brand">
          <Ball size={24} />
          <span>PadelApp2</span>
        </div>
        <div className="lp-footer-links">
          <Link href="/">Inicio</Link>
          <Link href="/entrar">Iniciar sesión</Link>
        </div>
      </footer>
    </div>
  );
}
