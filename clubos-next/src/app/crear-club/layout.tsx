import type { Metadata } from 'next';
import '@/styles/auth.css';

export const metadata: Metadata = {
  title: 'Crear tu club · PadelApp2',
  description: 'Empezá a gestionar tu club de pádel en minutos.',
  // Ya nadie la linkea desde la landing (el CTA manda a WhatsApp) — sigue
  // andando si alguien entra directo, pero no hace falta que Google la indexe.
  robots: { index: false, follow: false },
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
