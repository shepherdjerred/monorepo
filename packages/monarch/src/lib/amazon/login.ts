import type { Page } from "playwright";
import { log } from "../logger.ts";

async function runOp(args: string[]): Promise<string> {
  const proc = Bun.spawn(["op", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`op CLI failed: ${stderr.trim()}`);
  }
  return output.trim();
}

async function getAmazonCredentials(): Promise<{
  email: string;
  password: string;
}> {
  log.info("Fetching Amazon credentials from 1Password...");
  const [email, password] = await Promise.all([
    runOp(["item", "get", "Amazon", "--fields", "username", "--reveal"]),
    runOp(["item", "get", "Amazon", "--fields", "password", "--reveal"]),
  ]);
  return { email, password };
}

async function getAmazonTotp(): Promise<string> {
  return runOp(["item", "get", "Amazon", "--otp"]);
}

async function skipPasskeyNudge(page: Page): Promise<void> {
  const skipPasskey = page.locator(
    'input[value="Not now"], a:has-text("Not now"), button:has-text("Not now"), a:has-text("Skip")',
  );
  if (
    await skipPasskey
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false)
  ) {
    await skipPasskey.first().click();
    await page.waitForLoadState("domcontentloaded");
  }
}

export async function autoLogin(page: Page): Promise<void> {
  const { email, password } = await getAmazonCredentials();

  // Amazon may arrive with the account preselected: #ap_email is then a
  // hidden input already carrying the address and the page asks for the
  // password (or a passkey) directly, so only fill it when visible.
  const emailField = page.locator("#ap_email");
  if (await emailField.isVisible({ timeout: 3000 }).catch(() => false)) {
    await emailField.fill(email);

    const continueBtn = page.locator("input#continue");
    if (await continueBtn.isVisible()) {
      await continueBtn.click();
      await page.waitForLoadState("domcontentloaded");
    }
  }

  // The passkey interstitial can appear before the password page
  await skipPasskeyNudge(page);

  // Fill password unless the session already advanced past it
  const passwordField = page.locator("#ap_password");
  if (
    await passwordField
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await passwordField.fill(password);

    const signInBtn = page.locator("#signInSubmit");
    await signInBtn.click();
    await page.waitForLoadState("domcontentloaded");
  }

  // Handle TOTP if prompted
  const otpField = page.locator('#auth-mfa-otpcode, input[name="otpCode"]');
  if (await otpField.isVisible({ timeout: 3000 }).catch(() => false)) {
    log.info("2FA required, fetching TOTP from 1Password...");
    const totp = await getAmazonTotp();
    await otpField.fill(totp);
    const submitOtp = page.locator(
      '#auth-signin-button, button[type="submit"]',
    );
    await submitOtp.click();
    await page.waitForLoadState("domcontentloaded");
  }

  // Handle "Don't ask again on this device" checkbox
  const rememberCheck = page.locator("#auth-mfa-remember-device");
  if (await rememberCheck.isVisible().catch(() => false)) {
    await rememberCheck.check();
  }

  // Handle passkey nudge ("Not now" or "Skip")
  await skipPasskeyNudge(page);
}
