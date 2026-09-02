import { NextRequest, NextResponse } from 'next/server';
import { endSessionUrl, oidcConfig } from '@/lib/auth/oidc';
import { endSession } from '@/lib/auth/session';
import { isSameOriginMutation } from '@/lib/request-origin';

/**
 * POST /api/auth/logout — signs out for real.
 *
 * Deleting the cookie here is not enough: the provider's own session stays
 * alive, so pressing "Sign in" again would let you straight back in without
 * being asked for anything. On a shared computer that is worse than having no
 * button at all — whoever presses it believes they have left, and the next
 * person lands in their account. So the provider's end-session URL comes back
 * in the response and the browser goes there.
 *
 * POST and not GET: with GET, an image tag on any page could sign you out.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Cross-origin request refused' }, { status: 403 });
  }
  await endSession();

  const cfg = oidcConfig();
  // Signing out locally is already done and must not be left half-finished by
  // a network failure asking the provider where to send the browser next.
  const next = cfg ? ((await endSessionUrl(cfg).catch(() => null)) ?? '/') : '/';

  return NextResponse.json({ ok: true, next });
}
