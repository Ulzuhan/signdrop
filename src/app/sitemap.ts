import type { MetadataRoute } from 'next';

/** Empty until this deployment is both named and meant to be found. */
export default function sitemap(): MetadataRoute.Sitemap {
  const publicHost = process.env.SIGNDROP_PUBLIC_HOST?.trim();
  if (!publicHost || process.env.SIGNDROP_INDEXABLE !== '1') return [];
  const baseUrl = `https://${publicHost}`;

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${baseUrl}/verify`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ];
}
