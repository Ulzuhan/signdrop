import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const publicHost = process.env.SIGNDROP_PUBLIC_HOST?.trim();
  const baseUrl = publicHost ? `https://${publicHost}` : 'https://sign.kaicorplabs.com';

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/auth/'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
