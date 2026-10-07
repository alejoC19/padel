import type { Metadata } from 'next';
import '@/styles/devices.css';
import '@/styles/landing.css';

export const metadata: Metadata = {
  title: 'Política de privacidad · PadelApp2',
  description: 'Qué datos recopila PadelApp2, para qué se usan y cómo ejercer tus derechos sobre ellos.',
  robots: { index: true, follow: true },
};

export default function PrivacidadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
