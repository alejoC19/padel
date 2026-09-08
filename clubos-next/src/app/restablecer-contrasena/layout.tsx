import type { Metadata } from 'next';
import '@/styles/auth.css';

export const metadata: Metadata = {
  title: 'Restablecer contraseña',
  robots: { index: false, follow: false },
};

export default function RestablecerContrasenaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
