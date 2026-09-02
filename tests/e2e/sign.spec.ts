import { expect, test } from '@playwright/test';
import { blankContract, sessionCookie, throwawayCertificate } from './fixtures';

/**
 * Signing a contract the way somebody actually would, in a browser.
 *
 * Everything else in this repository verifies the output of the library. This
 * verifies that a person can get to it: load a document, put a signature on
 * the page, unlock a certificate, seal, and get a file back that the verifier
 * then accepts. On a desktop and on a phone, because a signing tool is used
 * on a phone — somebody is sent a contract and signs it where they read it.
 *
 * The workspace is behind a session, so the cookie is forged with the same
 * secret the server was started with. Getting in through the identity
 * provider is test-backchannel's job.
 */
test.beforeEach(async ({ context }) => {
  await context.addCookies([sessionCookie()]);
});

test('a contract, signed and then checked', async ({ page }, testInfo) => {
  const errores: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errores.push(m.text()));
  page.on('pageerror', (e) => errores.push(String(e)));

  const { p12, password, commonName } = throwawayCertificate();

  // ── The workspace, which a session reaches and a stranger does not ──
  await page.goto('/');
  await expect(page.getByText(/drop a pdf here/i)).toBeVisible();

  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'contrato.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await blankContract()),
  });

  // The viewer renders the page with pdf.js — from this origin, in a worker.
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });

  // The workspace is where a phone runs out of width: a toolbar of eight
  // controls, a page-sized canvas and a stamp on top of it.
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(desborde, `el espacio de trabajo desborda ${desborde}px`).toBeLessThanOrEqual(0);

  // ── A signature, typed rather than drawn: a mouse gesture is not what is
  // under test here, and the typed path is the one that has to find the
  // self-hosted font before it draws. ──
  await page.getByRole('button', { name: /^signature$/i }).first().click();
  await page.getByRole('button', { name: 'Type', exact: true }).click();
  await page.getByPlaceholder(/carmen garc/i).fill(commonName);
  await page.getByRole('button', { name: /use this signature/i }).click();

  await expect(page.locator('.sig-stamp-box').first()).toBeVisible();

  // ── The certificate ──
  await page.getByTitle('X.509 certificate (PAdES)').click();
  await page.locator('input[type="file"][accept=".p12,.pfx"]').setInputFiles({
    name: 'ana.p12',
    mimeType: 'application/x-pkcs12',
    buffer: Buffer.from(p12),
  });
  await page.getByPlaceholder(/password that protects the key/i).fill(password);
  await page.getByRole('button', { name: /^unlock$/i }).click();

  await expect(page.getByText(/unlocked and ready to sign/i)).toBeVisible({ timeout: 15_000 });
  // Self-signed, and the modal says so before anything is signed rather than
  // after — which is when knowing would be too late.
  await expect(page.getByText(/not on any trusted list|issuer not judged/i).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /use for signing/i }).click();

  // ── Seal, and take the file ──
  await page.getByRole('button', { name: /seal and download/i }).click();
  await page.getByRole('button', { name: /^seal the document$/i }).click();
  await expect(page.getByText(/^sealed$/i)).toBeVisible({ timeout: 60_000 });

  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: /download the sealed pdf/i }).click();
  const firmado = await descarga;
  const ruta = testInfo.outputPath('firmado.pdf');
  await firmado.saveAs(ruta);

  // ── And the other half of the product reads it ──
  await page.goto('/verify');
  await page.locator('input[type="file"]').setInputFiles(ruta);
  await expect(page.getByText(/the signature verifies/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(commonName).first()).toBeVisible();

  expect(errores, `console: ${errores.join(' | ')}`).toEqual([]);
});
