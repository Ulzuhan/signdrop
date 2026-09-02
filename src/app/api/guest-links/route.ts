import { NextRequest, NextResponse } from 'next/server';
import { jsonBody } from '@/lib/body';
import { clampTtlHours, mintGuestToken } from '@/lib/auth/guest';
import { getSession } from '@/lib/auth/session';
import { isSameOriginMutation, origenPublico } from '@/lib/request-origin';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/ratelimit';

/**
 * POST /api/guest-links — mints a link that lets somebody sign without an
 * account.
 *
 * Only somebody who has one can mint it, and the link says who did: if it
 * turns up somewhere it should not, there is a name to ask. Nothing is
 * stored — see src/lib/auth/guest.ts for why, and for what that costs.
 *
 * The response carries the whole URL rather than the bare token, because the
 * point of this is that it gets pasted into a message.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Cross-origin request refused' }, { status: 403 });
  }

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // An account is not a licence to mint invitations by the thousand.
  const limit = rateLimit(`invite:${session.sub}:${clientIp(request)}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit);

  const body = (await jsonBody(request)) ?? {};
  const token = mintGuestToken({
    by: session.sub,
    label: typeof body.label === 'string' ? body.label : undefined,
    ttlHours: body.ttlHours,
  });
  if (!token) {
    return NextResponse.json({ error: 'This instance cannot sign invitations.' }, { status: 503 });
  }

  return NextResponse.json({
    url: `${origenPublico(request)}/invite/${token}`,
    expiresInHours: clampTtlHours(body.ttlHours),
  });
}
