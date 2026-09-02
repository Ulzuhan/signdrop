'use client';

import React from 'react';
import { ExternalLink, X } from 'lucide-react';

/**
 * The part nobody explains, and the reason most people stop.
 *
 * SignDrop can do everything it promises and still be useless to somebody who
 * does not have a certificate and has never been told how to get one. In
 * Spain that means the FNMT, it takes an appointment and an identity check in
 * person or with Cl@ve, and — the step that actually defeats people — the
 * certificate then lives inside the browser that requested it and has to be
 * exported to a `.p12` before any other program can use it.
 *
 * The eIDAS table is here for the same reason the verifier reports three
 * verdicts instead of two: signing with a self-signed certificate is a
 * legitimate thing to do and it is not the same thing as a qualified
 * signature. Knowing which one you just made is the difference between a
 * document that binds somebody and a document that shows the bytes have not
 * changed.
 *
 * No affiliate anything, no "recommended provider": the FNMT is named because
 * it is the free one for a person resident in Spain, and the trusted lists in
 * this repository name the other 70-odd Spanish providers and every provider
 * in the Union.
 */
const PASOS = [
  {
    titulo: 'Ask for it',
    cuerpo:
      'On the FNMT site, under “Certificado de persona física”, request one. You get a code by email. Do it in a browser you can come back to: the request and the download have to happen on the same machine, in the same browser, without reinstalling it in between.',
    enlace: { href: 'https://www.sede.fnmt.gob.es/certificados/persona-fisica', texto: 'sede.fnmt.gob.es' },
  },
  {
    titulo: 'Prove who you are',
    cuerpo:
      'In person at a registry office with your ID and the code, or online with Cl@ve or a valid electronic ID card. This is the step that cannot be skipped, and it is what makes the certificate mean anything: nobody else can obtain one in your name.',
  },
  {
    titulo: 'Download it',
    cuerpo: 'Back on the same machine and browser, with the same code. The certificate installs itself into the browser rather than arriving as a file.',
  },
  {
    titulo: 'Export it to a .p12',
    cuerpo:
      'This is the step people get stuck on. In Chrome: Settings → Privacy and security → Security → Manage certificates → Your certificates → Export, with the private key, as PKCS#12. In Firefox: Settings → Privacy & Security → View Certificates → Your Certificates → Backup. Give it a password — that password never leaves your machine, and SignDrop asks for it to open the file.',
  },
];

const EIDAS = [
  {
    modo: 'Simple',
    que: 'A drawn or typed signature with no certificate.',
    vale: 'Admissible as evidence, and worth what the surrounding evidence makes it worth. It proves nothing on its own.',
    aqui: 'SignDrop stamps it and seals the document with a SHA-256 audit sheet. It does not call it a signature.',
  },
  {
    modo: 'Advanced',
    que: 'A certificate that identifies you, under your sole control, with any later change to the document detectable.',
    vale: 'Legally effective, and what most agreements between two willing parties need.',
    aqui: 'A PAdES signature with your .p12 — including a self-signed one. Acrobat validates the maths; whether it trusts the issuer is a separate question.',
  },
  {
    modo: 'Qualified',
    que: 'Advanced, plus a qualified certificate from a provider on an EU trusted list, on a qualified signature device.',
    vale: 'The legal equivalent of a handwritten signature across the whole Union, and the burden of proof shifts to whoever disputes it.',
    aqui: 'The same PAdES signature, with a qualified certificate — an FNMT one, for instance. /verify names the provider and says it is on the list.',
  },
];

export function GetACertificate({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border p-6 shadow-2xl sd-panel">
        <div className="flex items-start justify-between gap-4 border-b pb-4 sd-line">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-foreground sd-display">Getting a certificate</h3>
            <p className="text-[11px] text-muted-foreground">
              You need one to sign. It is free for a person resident in Spain, and it takes an appointment.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/5 hover:text-white">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <ol className="mt-5 space-y-4">
          {PASOS.map((paso, i) => (
            <li key={paso.titulo} className="flex gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                {i + 1}
              </span>
              <div>
                <h4 className="text-sm font-semibold text-foreground">{paso.titulo}</h4>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{paso.cuerpo}</p>
                {paso.enlace && (
                  <a
                    href={paso.enlace.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    {paso.enlace.texto}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-6 border-t pt-5 sd-line">
          <h4 className="text-sm font-semibold text-foreground sd-display">What each kind of signature is worth</h4>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Under eIDAS, the regulation that governs this across the Union. SignDrop can make the second and the third;
            which one you get depends on your certificate, not on this tool.
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b sd-line">
                  <th scope="col" className="py-2 pr-3 font-semibold text-foreground">Kind</th>
                  <th scope="col" className="py-2 pr-3 font-semibold text-foreground">What it is</th>
                  <th scope="col" className="py-2 pr-3 font-semibold text-foreground">What it is worth</th>
                  <th scope="col" className="py-2 font-semibold text-foreground">Here</th>
                </tr>
              </thead>
              <tbody>
                {EIDAS.map((fila) => (
                  <tr key={fila.modo} className="border-b align-top last:border-0 sd-line">
                    <th scope="row" className="py-2.5 pr-3 font-semibold text-foreground">{fila.modo}</th>
                    <td className="py-2.5 pr-3 text-muted-foreground">{fila.que}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{fila.vale}</td>
                    <td className="py-2.5 text-muted-foreground">{fila.aqui}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-[11px] text-muted-foreground">
            Outside Spain, look for your country&apos;s qualified providers — they are the ones SignDrop checks against,
            and there are more than three thousand authorities across the thirty territories in the store.
          </p>
        </div>

        <div className="mt-6 flex justify-end border-t pt-4 sd-line">
          <button type="button" onClick={onClose} className="sd-ghost-button">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
