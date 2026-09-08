import type { Metadata } from 'next';
import '@/styles/auth.css';

export const metadata: Metadata = {
  title: 'Aceptar invitación',
  robots: { index: false, follow: false },
};

export default function AceptarInvitacionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
