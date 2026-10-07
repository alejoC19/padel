import type { MetadataRoute } from 'next';
import { publicApi } from '@/lib/publicApi';

const SITE_URL = 'https://padelapp2.com';

/**
 * Las páginas de club (`/c/[slug]`) salen del directorio público en vivo,
 * no de una lista hardcodeada — así un club nuevo entra al sitemap solo,
 * sin tocar este archivo. Si el backend no responde, se sirve igual el
 * sitemap con las páginas estáticas: un sitemap parcial es mejor que un
 * build roto por el backend caído.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/jugador`, changeFrequency: 'weekly', priority: 0.8 },
  ];

  try {
    const { clubes } = await publicApi.directorio();
    const clubPages: MetadataRoute.Sitemap = clubes.map((c) => ({
      url: `${SITE_URL}/c/${c.slug}`,
      changeFrequency: 'weekly',
      priority: 0.6,
    }));
    return [...staticPages, ...clubPages];
  } catch {
    return staticPages;
  }
}
