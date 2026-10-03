import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { KaiCorpHeader } from '@/components/kaicorp-header';
import { KaiCorpFooter } from '@/components/kaicorp-footer';
import { Toaster } from 'sonner';
import { KaiCorpAccountMenu } from '@/components/kaicorp-account-menu';
import { InviteButton } from '@/components/invite-button';
import { getSession } from '@/lib/auth/session';
import { accountUrl, oidcConfigured } from '@/lib/auth/oidc';
import './globals.css';

const display = localFont({ variable: '--font-display', src: './fonts/space-grotesk.ttf', weight: '500 700', style: 'normal' });
const sans = localFont({ variable: '--font-sans', src: './fonts/inter.ttf', weight: '400 600', style: 'normal' });
const mono = localFont({ variable: '--font-mono', src: './fonts/jetbrains-mono.ttf', weight: '400 500', style: 'normal' });

/**
 * The four hands a typed signature can be written in.
 *
 * The licensed font files are bundled in this tree and served by next/font/local.
 * Neither the image build nor a visitor contacts a font CDN. This preserves
 * the same four signature hands and the CSP's font-src 'self' policy.
 *
 * Each one exposes a CSS variable rather than a family name, because the
 * hashed family next/font generates is not something anybody can type: the
 * canvas that renders the typed signature reads the variable to find out what
 * to draw with.
 */
const caveat = localFont({ variable: '--font-sig-caveat', src: './fonts/caveat.ttf', weight: '600', style: 'normal' });
const dancing = localFont({ variable: '--font-sig-dancing', src: './fonts/dancing-script.ttf', weight: '600', style: 'normal' });
const vibes = localFont({ variable: '--font-sig-vibes', src: './fonts/great-vibes.ttf', weight: '400', style: 'normal' });
const trad = localFont({ variable: '--font-sig-trad', src: './fonts/playwrite-us-trad.ttf', weight: '400', style: 'normal' });

const publicHost = process.env.SIGNDROP_PUBLIC_HOST?.trim();
const base = publicHost ? new URL(`https://${publicHost}`) : undefined;

const TITLE = 'SignDrop — Client-side PDF signing & cryptographic sealing';
const DESCRIPTION =
  'Zero-knowledge, browser-processed PDF signing and tamper-evident SHA-256 seal verification. Documents never upload to external servers.';

export const metadata: Metadata = {
  ...(base ? { metadataBase: base, alternates: { canonical: '/' } } : {}),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    siteName: 'SignDrop',
    locale: 'en',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#05070d',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  const oidcAvailable = oidcConfigured();
  const enrollUrl = process.env.SIGNDROP_ENROLL_URL?.trim();
  const provider = accountUrl();

  return (
    <html lang="en" className={`dark ${display.variable} ${sans.variable} ${mono.variable} ${caveat.variable} ${dancing.variable} ${vibes.variable} ${trad.variable}`}>
      <body className="flex min-h-screen flex-col bg-background text-foreground">
        <KaiCorpHeader app="SignDrop">
          {session ? (
            // The house's own menu, not three buttons of our own. Signing out
            // is its job too: it posts to /api/auth/logout and follows the
            // `next` it answers with, which is what actually ends the session
            // at the provider — the piece four of the five got wrong before
            // it was written once.
            <div className="flex items-center gap-2">
              <InviteButton />
              <KaiCorpAccountMenu email={session.email} name={session.name} accountUrl={provider ?? undefined} />
            </div>
          ) : oidcAvailable ? (
            <div className="flex items-center gap-2">
              <a
                href="/api/auth/login"
                className="rounded-lg bg-primary/10 px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-black"
              >
                Sign in
              </a>
              {enrollUrl && (
                <a
                  href={enrollUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sd-ghost-button"
                >
                  Request access
                </a>
              )}
            </div>
          ) : null}
        </KaiCorpHeader>

        <div className="flex flex-1 flex-col">{children}</div>

        <KaiCorpFooter current="signdrop" />
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
