import { expect, test } from '@playwright/test';
import { signedContract } from './fixtures';

/**
 * The half of the product that needs no account, in a real browser.
 *
 * This is the claim SignDrop is sold on: somebody receives a signed contract,
 * opens the verifier, and finds out whether it means anything — without
 * registering anywhere and without the document going anywhere. If this
 * breaks, nothing else matters.
 */
test.describe('checking a signature', () => {
  test('a signed contract is read, and what cannot be judged is said so', async ({ page }) => {
    const errores: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errores.push(m.text()));
    page.on('pageerror', (e) => errores.push(String(e)));

    const { bytes, commonName } = await signedContract();

    await page.goto('/verify');
    await expect(page.getByRole('heading', { name: /verify/i })).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'contrato.pdf',
      mimeType: 'application/pdf',
      buffer: bytes,
    });

    // The verdict, and the signer's own name out of the certificate.
    await expect(page.getByText(commonName).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/signature is valid|verifies|valid/i).first()).toBeVisible();

    // A self-signed certificate: the maths hold and the issuer does not. The
    // page has to say the second part rather than colouring everything green.
    await expect(page.getByText(/not on the trusted list|not judged/i).first()).toBeVisible();

    expect(errores, `console: ${errores.join(' | ')}`).toEqual([]);
  });

  test('a file that is not signed at all is not reported as broken', async ({ page }) => {
    const { blankContract } = await import('./fixtures');
    await page.goto('/verify');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'sin-firmar.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await blankContract('Sin firmar')),
    });
    await expect(page.getByText(/no digital signature/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('nothing is loaded from anywhere else, and the policy says so', async ({ page }) => {
    const fuera: string[] = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) fuera.push(r.url());
    });

    const respuesta = await page.goto('/verify');
    const csp = respuesta?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("worker-src 'self' blob:");

    await page.locator('input[type="file"]').setInputFiles({
      name: 'contrato.pdf',
      mimeType: 'application/pdf',
      buffer: (await signedContract()).bytes,
    });
    await page.waitForTimeout(3000);

    // The whole argument of the product, measured: opening somebody's
    // contract must not cause a single request to anybody else. The worker
    // and the character maps used to come from two CDNs.
    expect(fuera, `salió a: ${fuera.join(' | ')}`).toEqual([]);
  });
});

test.describe('and it fits on a phone', () => {
  test('no page scrolls sideways', async ({ page }) => {
    for (const ruta of ['/', '/verify']) {
      await page.goto(ruta);
      const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(desborde, `${ruta} desborda ${desborde}px`).toBeLessThanOrEqual(0);
    }
  });
});
