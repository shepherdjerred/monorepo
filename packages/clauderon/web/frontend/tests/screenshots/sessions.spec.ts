import { test, expect } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Session management screenshots for documentation
 *
 * IMPORTANT: These tests screenshot the REAL Clauderon web application.
 * Requirements:
 * 1. Dev server running: bun run dev (at http://localhost:5173)
 * 2. Clauderon daemon running: clauderon daemon (at http://localhost:3030)
 * 3. Some sessions created for screenshots
 *
 * Run with: bun run screenshots
 */

test.describe('Session Dashboard', () => {
  test('capture dashboard with sessions', async ({ page }) => {
    // Navigate to REAL dashboard
    await page.goto('http://localhost:5173');

    // Wait for app to load
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Take screenshot of REAL dashboard
    const screenshotPath = join(__dirname, '..', '..', '..', '..', 'screenshots', 'web', 'dashboard.png');
    await page.screenshot({
      path: screenshotPath,
      fullPage: false,
    });

    console.log(`✓ Created dashboard.png from REAL application`);
  });
});
