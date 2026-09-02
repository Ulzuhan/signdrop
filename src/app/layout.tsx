import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Inter, JetBrains_Mono } from 'next/font/google';
import { KaiCorpHeader } from '@/components/kaicorp-header';
import { KaiCorpFooter } from '@/components/kaicorp-footer';
import { Toaster } from 'sonner';
import { getSession } from '@/lib/auth/session';
import { isOidcEnabled } from '@/lib/auth/oidc';
import './globals.css';

const display = Space_Grotesk({ variable: '--font-display', weight: ['500', '600', '700'], subsets: ['latin'] });
const sans = Inter({ variable: '--font-sans', weight: ['400', '500', '600'], subsets: ['latin'] });
const mono = JetBrains_Mono({ variable: '--font-mono', weight: ['400', '500'], subsets: ['latin'] });

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
    locale: 'es_ES',
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
  const oidcAvailable = isOidcEnabled();
  const enrollUrl = process.env.SIGNDROP_ENROLL_URL?.trim();

  return (
    <html lang="es" className={`dark ${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col bg-background text-foreground">
        <KaiCorpHeader app="SignDrop">
          {session ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{session.name || session.email}</span>
              <a
                href="/api/auth/logout"
                className="rounded-lg border px-2.5 py-1 text-xs text-muted-foreground hover:bg-white/5 hover:text-white"
                style={{ borderColor: 'var(--kc-line)' }}
              >
                Cerrar sesión
              </a>
            </div>
          ) : oidcAvailable ? (
            <div className="flex items-center gap-2">
              <a
                href="/api/auth/login"
                className="rounded-lg bg-primary/10 px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-black"
              >
                Iniciar sesión
              </a>
              {enrollUrl && (
                <a
                  href={enrollUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border px-3 py-1 text-xs text-muted-foreground hover:bg-white/5 hover:text-white"
                  style={{ borderColor: 'var(--kc-line)' }}
                >
                  Registrarse
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
