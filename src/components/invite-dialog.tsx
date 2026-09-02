'use client';

import React, { useState } from 'react';
import { Check, Copy, Link2, X } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Inviting the other party to sign.
 *
 * The dialog exists because the alternative is telling someone to register
 * for a service they did not choose, in order to return a document that was
 * sent to them. What comes out is a link and nothing else — no email is sent
 * from here, because that would mean the server knowing who is signing what,
 * and it does not.
 *
 * The label is for the person minting the link, and it never leaves this
 * deployment: it goes inside the signed token so a link found somewhere it
 * should not be can be placed. The guest never sees it.
 *
 * How long it lasts matters more than it looks: a single link cannot be
 * revoked (src/lib/auth/guest.ts explains why), so the expiry is the only
 * thing that ends it. The default is a day.
 */
const DURACIONES = [
  { hours: 4, label: '4 hours' },
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
];

export function InviteDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [ttlHours, setTtlHours] = useState(24);
  const [link, setLink] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const mint = async () => {
    setWorking(true);
    try {
      const res = await fetch('/api/guest-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || undefined, ttlHours }),
      });
      if (!res.ok) {
        toast.error(res.status === 401 ? 'Your session has ended. Sign in again.' : 'The invitation could not be created.');
        return;
      }
      const data = await res.json();
      setLink(data.url);
    } catch {
      toast.error('The invitation could not be created.');
    } finally {
      setWorking(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Copy it by hand: this browser did not allow it.');
    }
  };

  const close = () => {
    setLink(null);
    setLabel('');
    setCopied(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border p-6 shadow-2xl sd-panel">
        <div className="flex items-start justify-between gap-4 border-b pb-4 sd-line">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Link2 className="size-5" aria-hidden />
            </div>
            <div>
              <h3 className="text-lg font-bold tracking-tight text-foreground sd-display">Invite someone to sign</h3>
              <p className="text-[11px] text-muted-foreground">A link that works without an account. It cannot be undone once sent.</p>
            </div>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/5 hover:text-white">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {!link ? (
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="invite-label" className="text-xs font-semibold text-muted-foreground">
                Who it is for
              </label>
              <input
                id="invite-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Luis, the lease"
                className="mt-1.5 w-full rounded-xl border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary sd-line"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                For you, not for them. It travels inside the link so you can place it later; they never see it.
              </p>
            </div>

            <fieldset>
              <legend className="text-xs font-semibold text-muted-foreground">Good for</legend>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {DURACIONES.map((d) => (
                  <button
                    key={d.hours}
                    type="button"
                    onClick={() => setTtlHours(d.hours)}
                    aria-pressed={ttlHours === d.hours}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      ttlHours === d.hours ? 'border-transparent bg-primary text-black' : 'sd-line text-muted-foreground hover:text-white'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                A link cannot be withdrawn once it is out — it stops working when it expires. Their time-stamps count
                against your allowance.
              </p>
            </fieldset>

            <div className="flex items-center justify-end gap-2 border-t pt-4 sd-line">
              <button type="button" onClick={close} className="sd-ghost-button">
                Cancel
              </button>
              <button type="button" onClick={mint} disabled={working} className="sd-primary-button disabled:opacity-50">
                <Link2 className="size-4" aria-hidden />
                {working ? 'Creating…' : 'Create the link'}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border p-3 sd-inset">
              <p className="break-all font-mono text-[11px] text-foreground">{link}</p>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Send it however you would send the document. Whoever opens it can sign, and only sign: they cannot invite
              anybody else, and they never see anything of yours — the server has nothing of yours to show them.
            </p>
            <div className="flex items-center justify-end gap-2 border-t pt-4 sd-line">
              <button type="button" onClick={close} className="sd-ghost-button">
                Done
              </button>
              <button type="button" onClick={copy} className="sd-primary-button">
                {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied ? 'Copied' : 'Copy the link'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
