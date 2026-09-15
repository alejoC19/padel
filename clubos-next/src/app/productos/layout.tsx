import type { Metadata } from 'next';
import '@/styles/app.css';
import '@/styles/screens.css';
import '@/styles/design-system.css';
import '@/styles/components.css';

export const metadata: Metadata = {
  title: 'Productos',
  robots: { index: false, follow: false },
};

export default function ProductosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
