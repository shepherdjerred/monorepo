import { expect, type Page } from "@playwright/test";

function appUrl(page: Page): URL {
  return new URL(page.url());
}

function requiredSecret(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for beta Scout design checks`);
  }
  return value;
}

export async function signInForAudit(page: Page): Promise<void> {
  const url = appUrl(page);

  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    const discordId =
      process.env["SCOUT_DESIGN_AUDIT_DISCORD_ID"] ?? "000000000000000001";
    const login = new URL("/api/dev/login", url.origin);
    login.searchParams.set("discordId", discordId);
    login.searchParams.set("returnTo", "/app/");
    await page.goto(login.toString(), { waitUntil: "domcontentloaded" });
  } else {
    await page.goto(new URL("/app/login", url.origin).toString(), {
      waitUntil: "domcontentloaded",
    });
    const loginLink = page.getByRole("link", { name: /discord/i });
    await expect(
      loginLink,
      "beta login must expose Discord OAuth",
    ).toBeVisible();
    await loginLink.click();
    await expect(page).toHaveURL(/discord\.com/);
    await page
      .getByLabel(/email/i)
      .fill(requiredSecret("SCOUT_DESIGN_AUDIT_DISCORD_EMAIL"));
    await page
      .getByLabel(/password/i)
      .fill(requiredSecret("SCOUT_DESIGN_AUDIT_DISCORD_PASSWORD"));
    await page.getByRole("button", { name: /log in|login/i }).click();
    const oneTimeCode = process.env["SCOUT_DESIGN_AUDIT_DISCORD_TOTP"];
    if (oneTimeCode !== undefined && oneTimeCode.length > 0) {
      const code = page.getByLabel(/authenticator|verification|code/i);
      if (await code.isVisible()) {
        await code.fill(oneTimeCode);
        await page
          .getByRole("button", { name: /submit|verify|continue/i })
          .click();
      }
    }
    await page.waitForURL(
      (candidate) =>
        candidate.origin === url.origin &&
        candidate.pathname.startsWith("/app"),
    );
  }

  await expect(page).not.toHaveURL(/\/app\/login/);
  const sessionState = await page.request.get(
    new URL("/trpc/auth.sessionState", url.origin).toString(),
  );
  expect(
    sessionState.ok(),
    "design audit login did not create a valid session",
  ).toBe(true);
}
