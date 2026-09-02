import { NextRequest, NextResponse } from 'next/server';
import { GUEST_COOKIE, guestCookieOptions, readGuestToken } from '@/lib/auth/guest';

/**
 * GET /invite/<token> — the door a guest link opens.
 *
 * The token travels in the path because that is what survives being pasted
 * into a chat window. It is checked here and then moved into an httpOnly
 * cookie, so it stops appearing in the address bar, in the browser history
 * and in the Referer of anything the page loads afterwards.
 *
 * A bad or expired token does not say which: it lands on the front page,
 * which will ask for an account. Whoever is trying tokens has not earned the
 * distinction.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const link = readGuestToken(token);
  if (!link) return NextResponse.redirect(new URL('/?invite=expired', request.nextUrl.origin), 302);

  const response = NextResponse.redirect(new URL('/', request.nextUrl.origin), 302);
  response.cookies.set(GUEST_COOKIE, token, {
    ...guestCookieOptions,
    // Not a day longer than the link itself claims to last.
    maxAge: Math.max(1, link.exp - Math.floor(Date.now() / 1000)),
  });
  return response;
}
