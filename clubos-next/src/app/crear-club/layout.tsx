import type { Metadata } from 'next';
import '@/styles/auth.css';

export const metadata: Metadata = {
  title: 'Crear tu club · ClubOS',
  description: 'Empezá a gestionar tu club de pádel en minutos.',
  robots: { index: true, follow: true },
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
