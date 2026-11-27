import { expect, test } from "@playwright/test";

const storyUrl =
  "/iframe.html?viewMode=story&id=components-overlays-bottomsheet--default";

test.use({ viewport: { width: 390, height: 844 } });

test("bottom sheet opens, traps focus and closes from every dismissal", async ({
  page,
}) => {
  await page.goto(storyUrl);
  const trigger = page.getByRole("button", { name: "More filters" });
  await trigger.click();

  const sheet = page.getByRole("dialog", { name: "More filters" });
  await expect(sheet).toBeVisible();

  // The close button is a 44px target.
  const close = sheet.getByRole("button", { name: "Close" });
  const box = await close.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);

  // Focus stays inside the sheet however far the reader tabs.
  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press("Tab");
    await expect(page.locator('[role="dialog"]:focus-within')).toHaveCount(1);
  }

  // Escape closes and returns focus to the trigger.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();

  // A press on the backdrop closes it.
  await trigger.click();
  await expect(sheet).toBeVisible();
  // Radix focuses the sheet once its dismissal handlers are live.
  await expect(sheet.getByRole("button", { name: "Close" })).toBeFocused();
  await page.locator(".scout-overlay").click({ position: { x: 195, y: 40 } });
  await expect(sheet).toBeHidden();

  // The close button closes it.
  await trigger.click();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
});
