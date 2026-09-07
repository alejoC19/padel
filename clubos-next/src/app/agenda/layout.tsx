import type { Metadata } from 'next';
import '@/styles/app.css';
import '@/styles/screens.css';
import '@/styles/design-system.css';
import '@/styles/components.css';
import '@/styles/booking-dialog.css';
import '@/styles/agenda-board.css';

export const metadata: Metadata = {
  title: 'Agenda',
  // La agenda es privada: no tiene sentido que la indexe un buscador.
  robots: { index: false, follow: false },
};

export default function AgendaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
