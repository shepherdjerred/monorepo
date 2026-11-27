import { expect, test } from "@playwright/test";

const story = (id: string): string => `/iframe.html?viewMode=story&id=${id}`;
const ahriTips = story("domain-generatedtiplist--ahri-general");
const ahriIntoZed = story("domain-generatedtiplist--ahri-into-zed");
const jaxCombos = story("domain-comborow--jax");

test.describe("pointer", () => {
  test("hovering a named ability in a tip opens that ability's tooltip", async ({
    page,
  }) => {
    await page.goto(ahriTips);
    await page
      .getByRole("button", { name: "Charm", exact: true })
      .first()
      .hover();
    const layer = page.getByRole("dialog", { name: "Charm", exact: true });
    await expect(layer).toBeVisible();
    await expect(layer.getByText("Ahri's E")).toBeVisible();
  });

  test("a keyword in a tip opens the keyword's own tooltip", async ({
    page,
  }) => {
    await page.goto(story("domain-tiptext--keyword-open"));
    const layer = page.getByRole("dialog");
    await expect(layer).toHaveCount(1);
    await expect(layer).toBeVisible();
    await expect(layer.getByText("Keyword", { exact: true })).toBeVisible();
  });

  test("hovering a combo step opens its ability", async ({ page }) => {
    await page.goto(jaxCombos);
    await page
      .getByRole("button", { name: "Jax Q", exact: true })
      .first()
      .hover();
    await expect(
      page.getByRole("dialog", { name: "Jax Q", exact: true }),
    ).toBeVisible();
  });

  test("the other side is closed, and opens in place", async ({ page }) => {
    await page.goto(ahriIntoZed);
    const flip = page.locator("details");
    await expect(flip).not.toHaveAttribute("open", "");
    const rows = page.locator("ol > li:visible");
    const before = await rows.count();
    await flip.locator("summary").click();
    await expect(flip).toHaveAttribute("open", "");
    expect(await rows.count()).toBeGreaterThan(before);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a tap on a named ability opens a bottom sheet, and Close returns focus", async ({
    page,
  }) => {
    await page.goto(ahriTips);
    const trigger = page
      .getByRole("button", { name: "Charm", exact: true })
      .first();
    await trigger.tap();

    const sheet = page.getByRole("dialog", { name: "Charm", exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Ahri's E")).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box?.width).toBe(390);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(844, 0);

    await page.getByRole("button", { name: "Close" }).tap();
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("a tap on a combo step opens a bottom sheet", async ({ page }) => {
    await page.goto(jaxCombos);
    await page
      .getByRole("button", { name: "Jax Q", exact: true })
      .first()
      .tap();
    const sheet = page.getByRole("dialog", { name: "Jax Q", exact: true });
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box?.width).toBe(390);
  });

  for (const id of [
    "domain-generatedtiplist--long-text",
    "domain-generatedtiplist--ahri-into-zed",
    "domain-comborow--long-text",
    "domain-comborow--talon",
    "domain-comborow--reference-in-phone-width",
  ]) {
    test(`${id} does not scroll sideways`, async ({ page }) => {
      await page.goto(story(id));
      await expect(page.locator("#storybook-root")).toBeVisible();
      const overflow = await page
        .locator("html")
        .evaluate((root) => root.scrollWidth - root.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
