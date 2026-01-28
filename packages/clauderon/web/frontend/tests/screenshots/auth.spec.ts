import { test, expect } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Authentication screenshots for documentation
 *
 * IMPORTANT: These tests screenshot the REAL Clauderon web application.
 * The dev server must be running at http://localhost:5173
 *
 * Run with: bun run screenshots
 */

test.describe('Authentication UI', () => {
  test('capture login page', async ({ page }) => {
    // Navigate to REAL login page
    await page.goto('http://localhost:5173');

    // Wait for page to fully load
    await page.waitForLoadState('networkidle');

    // Wait a bit for any animations
    await page.waitForTimeout(500);

    // Take screenshot of REAL login page - 1080p
    const screenshotPath = join(__dirname, '..', '..', '..', '..', 'screenshots', 'web', 'login.png');
    await page.screenshot({
      path: screenshotPath,
      fullPage: false,
      type: 'png',
    });

    console.log(`✓ Created login.png from REAL application`);
  });
});
