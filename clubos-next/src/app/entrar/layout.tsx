import type { Metadata } from 'next';
import '@/styles/auth.css';

export const metadata: Metadata = {
  title: 'Entrar',
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
