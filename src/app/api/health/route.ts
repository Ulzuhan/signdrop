import { NextResponse } from 'next/server';
import { oidcConfigured } from '@/lib/auth/oidc';
import { sessionSecret } from '@/lib/auth/session';

/**
 * Is this instance able to do its job?
 *
 * Not "is the process up" — the container's HEALTHCHECK could learn that from
 * any route. What it cannot learn from any route is whether the two things
 * that have to be configured actually are, and both fail silently: without a
 * session secret nobody can sign in, and without the OIDC client the sign-in
 * button leads to a 503. A container that answers 200 while nobody can get in
 * is a container the watchdog will call healthy for as long as it lasts.
 *
 * The trust store is reported too, because it is a set of static files that
 * can simply not be there — an image built without them serves a /verify that
 * silently judges nobody. Reported, not fatal: verifying the maths still
 * works, and saying so is the honest degradation.
 *
 * Nothing here identifies the deployment or its provider: the response is a
 * handful of booleans and a count. It is reachable without a session because
 * the container has none.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = Boolean(sessionSecret());
  const identity = oidcConfigured();

  let territories = 0;
  try {
    const { readFile } = await import('node:fs/promises');
    const index = JSON.parse(await readFile(new URL('../../../../public/trust/index.json', import.meta.url), 'utf8'));
    territories = Object.values(index.territories ?? {}).filter((t) => !(t as { unavailable?: string }).unavailable).length;
  } catch {
    territories = 0;
  }

  const ready = session && identity;
  return NextResponse.json(
    { status: ready ? 'ok' : 'degraded', session, identity, trustedLists: territories },
    { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  );
}
