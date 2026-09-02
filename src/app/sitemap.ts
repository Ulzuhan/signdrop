import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const publicHost = process.env.SIGNDROP_PUBLIC_HOST?.trim();
  const baseUrl = publicHost ? `https://${publicHost}` : 'https://sign.kaicorplabs.com';

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
