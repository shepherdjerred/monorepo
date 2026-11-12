import { expect, test } from "@playwright/test";

// Keyboard navigation is desktop-only; the mobile project ignores *.desktop.spec.ts.
test("the keyboard moves a real focus through the list and steps back out of an issue", async ({
  page,
}) => {
  await page.goto("/issues?sort=created");
  const rows = page.locator("a[data-issue-row]");
  await expect(rows.first()).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("j");
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toBeFocused();
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(rows.nth(0)).not.toHaveAttribute("aria-current", "true");
  await rows.nth(4).hover();
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("k");
  await expect(rows.nth(0)).toBeFocused();
  const identifier = await rows.nth(0).getAttribute("data-issue-row");
  if (identifier === null) throw new Error("The focused row has no issue");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`peek=${identifier}$`, "u"));
  await expect(page.getByRole("dialog")).toContainText(identifier);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/issues\?sort=created$/u);
  await expect(rows.nth(0)).toBeFocused();

  await page.keyboard.press("Enter");
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Open full issue", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/issues/${identifier}$`, "u"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Escape steps back through this tab's history instead of resetting the list.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(
    new RegExp(String.raw`/issues\?sort=created&peek=${identifier}$`, "u"),
  );
  await expect(page.getByRole("dialog")).toContainText(identifier);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/issues\?sort=created$/u);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Escape on an issue opened directly returns to the issue list", async ({
  page,
}) => {
  await page.goto("/issues/AI-1");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/issues$/u);
});

// An IME's confirming Enter (Japanese, Chinese, Korean) must not act. Safari
// clears `isComposing` before that keydown, so a keydown right after
// `compositionend` counts as composing too.
test("Enter that confirms an IME conversion neither saves a title nor picks a palette result", async ({
  page,
}) => {
  await page.goto("/issues/AI-1");
  const title = page.getByLabel("Issue title", { exact: true });
  await title.click();
  await title.press("End");
  const imeEnter = (selector: string, safariOrder: boolean) =>
    page.evaluate(
      ([target, safari]) => {
        const element = globalThis.document.querySelector(target);
        if (element === null) throw new Error(`Missing ${target}`);
        if (safari) {
          element.dispatchEvent(
            new globalThis.CompositionEvent("compositionend", {
              bubbles: true,
            }),
          );
        }
        element.dispatchEvent(
          new globalThis.KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
            isComposing: !safari,
          }),
        );
      },
      [selector, safariOrder] as const,
    );
  for (const safari of [false, true]) {
    await imeEnter('[aria-label="Issue title"]', safari);
    await expect(title).toBeFocused();
  }
  // A real Enter comes after the 50 ms window that follows compositionend.
  await page.waitForTimeout(100);
  await title.press("Enter");
  await expect(title).not.toBeFocused();

  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByLabel("Search issues and commands");
  await search.fill("Go to board");
  for (const safari of [false, true]) {
    await imeEnter('[aria-label="Search issues and commands"]', safari);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(/\/issues\/AI-1$/u);
  }
  await page.waitForTimeout(100);
  await search.press("Enter");
  await expect(page).toHaveURL(/\/board/u);
});
