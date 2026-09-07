import type { Metadata } from 'next';
import '@/styles/app.css';
import '@/styles/screens.css';
import '@/styles/design-system.css';
import '@/styles/components.css';

export const metadata: Metadata = {
  title: 'Buffet',
  robots: { index: false, follow: false },
};

export default function BuffetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
