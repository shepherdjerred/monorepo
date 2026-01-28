import { test, expect } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Dialog screenshots for documentation
 *
 * IMPORTANT: These tests screenshot the REAL Clauderon web application.
 * Make sure you have some sessions created to interact with.
 *
 * Run with: bun run screenshots
 */

test.describe('Dialog UI', () => {
  test('capture create session dialog', async ({ page }) => {
    // Navigate to REAL app
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');

    // Click the real "New Session" button
    const createButton = page.getByRole('button', { name: /new session|create/i }).first();

    if (await createButton.isVisible()) {
      await createButton.click();

      // Wait for REAL dialog to appear
      await page.waitForTimeout(500);

      // Take screenshot of REAL create dialog - 1080p high quality
      const screenshotPath = join(__dirname, '..', '..', '..', '..', 'screenshots', 'web', 'create-dialog.png');
      await page.screenshot({
        path: screenshotPath,
        fullPage: false,
        type: 'png',
        quality: 100,
      });

      console.log(`✓ Created create-dialog.png from REAL application`);
    } else {
      console.log('⚠ Could not find create button - is the app loaded?');
    }
  });
});
