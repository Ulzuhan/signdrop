import type { MetadataRoute } from 'next';

/**
 * What crawlers may do here.
 *
 * Two things are deliberate. The host is only ever the configured one — a
 * copy of this MIT repository running elsewhere must not advertise our
 * domain — and with `SIGNDROP_INDEXABLE` unset the answer is a flat refusal,
 * because a service that is deployed but not announced should not turn up in
 * a search before its owner says so.
 */
export default function robots(): MetadataRoute.Robots {
  const publicHost = process.env.SIGNDROP_PUBLIC_HOST?.trim();
  const indexable = process.env.SIGNDROP_INDEXABLE === '1' && Boolean(publicHost);

  if (!indexable) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/auth/'],
    },
    sitemap: `https://${publicHost}/sitemap.xml`,
  };
}
