'use client';

import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { InviteDialog } from './invite-dialog';

/**
 * The way in to inviting somebody, in the header rather than buried in the
 * account menu: it is a thing you do to a document, not a setting.
 *
 * Rendered only for people with a session — a guest cannot invite another
 * guest, and the route refuses it anyway.
 */
export function InviteButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="sd-ghost-button">
        <UserPlus className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Invite to sign</span>
      </button>
      <InviteDialog isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
