// Capture the illustrative React walkthrough; never connects to a real identity provider.
// Setup and usage: docs/authoring.md.
const { chromium } = require('../../webui/node_modules/@playwright/test');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const { PNG } = require('pngjs');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'docs/assets/journeys');
const scenes = [
  ['allowed', 'Open application'], ['signin', 'First sign-in'],
  ['attack', 'Malicious request'], ['role', 'Insufficient role'],
  ['expired', 'Expired session'], ['bypass', 'Direct backend access'],
];
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1480, height: 1200 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    // A signed-out shell is sufficient; keep media generation independent of backend state.
    await page.route('**/auth/providers', route => route.fulfill({ json: { providers: [{ id: 'keycloak', name: 'Keycloak' }] } }));
    await page.route('**/auth/me', route => route.fulfill({ status: 401, json: { error: 'Sign in required' } }));
    await page.goto(`${process.env.DOCS_UI_URL || 'http://127.0.0.1:4173'}/#journey`);
    await page.getByRole('heading', { name: 'What happens when…' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const lab = page.getByRole('region', { name: 'Interactive request walkthrough' });
    const manifest = [];
    for (const [id, label] of scenes) {
      await page.getByRole('button', { name: label, exact: true }).click();
      const steps = page.getByRole('group', { name: 'Walkthrough steps' }).getByRole('button');
      const count = await steps.count();
      const gif = GIFEncoder();
      const titles = [];
      for (let i = 0; i < count; i++) {
        await steps.nth(i).click();
        titles.push(await steps.nth(i).getAttribute('aria-label'));
        const buffer = await lab.screenshot({ animations: 'disabled' });
        const frame = PNG.sync.read(buffer);
        const palette = quantize(frame.data, 256);
        gif.writeFrame(applyPalette(frame.data, palette), frame.width, frame.height, {
          palette, delay: i === count - 1 ? 4200 : 2600, repeat: 0,
        });
        if (i === count - 1) fs.writeFileSync(path.join(output, `${id}.png`), buffer);
      }
      gif.finish();
      const bytes = gif.bytes();
      fs.writeFileSync(path.join(output, `${id}.gif`), bytes);
      manifest.push({ id, label, steps: titles, gifBytes: bytes.length });
      console.log(`${id}: ${count} steps, ${Math.round(bytes.length / 1024)} KiB`);
    }
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
