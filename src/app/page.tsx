import Link from 'next/link';
import { FileSearch, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { Workspace } from '@/components/workspace';
import { getSession } from '@/lib/auth/session';
import { currentGuest } from '@/lib/auth/guest';
import { oidcConfigured } from '@/lib/auth/oidc';

/**
 * The door.
 *
 * Signing needs an account or a guest link somebody with one handed out;
 * verifying needs nothing at all, and never will. That asymmetry is the
 * product: whoever receives a signed contract must be able to check it
 * without registering anywhere, and whoever is asked to sign one must be able
 * to do it without being enrolled in a service they did not choose.
 *
 * Everything past this point runs in the visitor's browser. The gate is about
 * who may spend this deployment's time-stamp quota and see its workspace, not
 * about who may see a document — the server never has one.
 */
export default async function HomePage() {
  const [session, guest] = await Promise.all([getSession(), currentGuest()]);
  if (session || guest) return <Workspace />;

  const canSignIn = oidcConfigured();
  const enrollUrl = process.env.SIGNDROP_ENROLL_URL?.trim();

  return (
    <main className="kc-product-landing flex flex-1 flex-col items-center justify-center px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <div className="sd-eyebrow">
          <Lock className="size-3.5" aria-hidden />
          Nothing is uploaded. Not the document, not the certificate.
        </div>

        <h1 className="sd-landing-title">Sign a PDF where it already is</h1>

        <p className="sd-landing-lede">
          SignDrop stamps, seals and signs PDFs in the browser. The PAdES signature is the real thing — Acrobat validates
          it, the certificate is checked against the qualified authorities of the EU trusted lists, and a second
          signature does not break the first.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {canSignIn && (
            <a href="/api/auth/login" className="sd-primary-button">
              <KeyRound className="size-4" aria-hidden />
              Sign in to sign
            </a>
          )}
          <Link href="/verify" className="sd-ghost-button sd-ghost-button--large">
            <FileSearch className="size-4" aria-hidden />
            Check a signature
          </Link>
        </div>

        <p className="sd-landing-note">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          <span>
            Checking a signature needs no account and never will. Signing needs one — or an invitation from somebody who
            has one, which is how the other side of a contract signs it without joining anything.
            {enrollUrl ? (
              <>
                {' '}
                <a href={enrollUrl} target="_blank" rel="noopener noreferrer" className="sd-inline-link">
                  Ask for an account
                </a>
                .
              </>
            ) : null}
          </span>
        </p>
      </div>
    </main>
  );
}
