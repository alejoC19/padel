import type { Metadata } from 'next';
import '@/styles/auth.css';

export const metadata: Metadata = {
  title: 'Olvidé mi contraseña',
  robots: { index: false, follow: false },
};

export default function OlvidePasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
