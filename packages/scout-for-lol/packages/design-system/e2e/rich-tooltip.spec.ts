import { expect, test, type Page } from "@playwright/test";

const interactive =
  "/iframe.html?viewMode=story&id=domain-entitytooltip--interactive";
const threeLayers =
  "/iframe.html?viewMode=story&id=domain-entitytooltip--three-layers";

const OPEN_DELAY = 350;
const CLOSE_DELAY = 150;

const layer = (page: Page, name: string) =>
  page.getByRole("dialog", { name, exact: true });

test.describe("pointer", () => {
  test("hover opens a layer after the open delay, not before", async ({
    page,
  }) => {
    await page.clock.install();
    await page.goto(interactive);
    await page.getByRole("button", { name: "Ahri", exact: true }).hover();

    await page.clock.runFor(OPEN_DELAY - 50);
    await expect(layer(page, "Ahri")).toHaveCount(0);

    await page.clock.runFor(100);
    await expect(layer(page, "Ahri")).toBeVisible();
    // The fact is loaded for the layer; its header names the champion.
    await expect(
      layer(page, "Ahri").getByText("the Nine-Tailed Fox"),
    ).toBeVisible();
  });

  test("leaving before the delay never opens it", async ({ page }) => {
    await page.clock.install();
    await page.goto(interactive);
    await page.getByRole("button", { name: "Ahri", exact: true }).hover();
    await page.clock.runFor(OPEN_DELAY - 100);
    await page.mouse.move(700, 600);
    await page.clock.runFor(1000);
    await expect(layer(page, "Ahri")).toHaveCount(0);
  });

  test("moving into a child keeps the parent open, and leaving closes both after the grace period", async ({
    page,
  }) => {
    await page.clock.install();
    await page.goto(interactive);
    await page.getByRole("button", { name: "Ahri", exact: true }).hover();
    await page.clock.runFor(OPEN_DELAY + 50);
    await expect(layer(page, "Ahri")).toBeVisible();

    // Hover the Charm ability inside the champion layer.
    await layer(page, "Ahri").getByRole("button", { name: "Charm" }).hover();
    await page.clock.runFor(OPEN_DELAY + 50);
    await expect(layer(page, "Charm")).toBeVisible();

    // Into the child, then well past the grace period: both stay.
    await layer(page, "Charm").getByText("Cooldown").hover();
    await page.clock.runFor(CLOSE_DELAY * 4);
    await expect(layer(page, "Charm")).toBeVisible();
    await expect(layer(page, "Ahri")).toBeVisible();

    // The child sits beside its parent, not over its middle.
    const parentBox = await layer(page, "Ahri").boundingBox();
    const childBox = await layer(page, "Charm").boundingBox();
    expect(parentBox).not.toBeNull();
    expect(childBox).not.toBeNull();
    if (parentBox === null || childBox === null) return;
    expect(childBox.x).toBeGreaterThan(parentBox.x + parentBox.width / 2);

    // Out of everything: nothing closes inside the grace period, all does after.
    await page.mouse.move(5, 700);
    await page.clock.runFor(CLOSE_DELAY - 50);
    await expect(layer(page, "Charm")).toBeVisible();
    await page.clock.runFor(200);
    await expect(layer(page, "Charm")).toHaveCount(0);
    await expect(layer(page, "Ahri")).toHaveCount(0);
  });
});

test.describe("keyboard", () => {
  test("Escape closes only the top layer", async ({ page }) => {
    await page.goto(threeLayers);
    await expect(layer(page, "Ahri")).toBeVisible();
    await expect(layer(page, "Charm")).toHaveCount(2);

    // The keyword layer is the top one.
    await page.keyboard.press("Escape");
    await expect(layer(page, "Charm")).toHaveCount(1);
    await expect(layer(page, "Ahri")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(layer(page, "Charm")).toHaveCount(0);
    await expect(layer(page, "Ahri")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(layer(page, "Ahri")).toHaveCount(0);
  });

  test("a part is reachable by keyboard and opens its own layer with focus in it", async ({
    page,
  }) => {
    await page.goto(interactive);
    const trigger = page.getByRole("button", { name: "Ahri", exact: true });
    await expect(trigger).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(trigger).toBeFocused();
    // Focus opens immediately and leaves focus on the trigger.
    await expect(layer(page, "Ahri")).toBeVisible();
    await expect(trigger).toBeFocused();

    // The right arrow moves focus into the layer, onto its first part. Wait
    // for the fact to load first: a layer still showing its skeleton has no
    // part to focus.
    await expect(
      layer(page, "Ahri").getByRole("button", { name: "Essence Theft" }),
    ).toBeVisible();
    await page.keyboard.press("ArrowRight");
    const ahri = layer(page, "Ahri");
    await expect(
      ahri.getByRole("button", { name: "Essence Theft" }),
    ).toBeFocused();

    // Tab to the Charm ability: its layer opens on focus.
    for (let press = 0; press < 3; press += 1) await page.keyboard.press("Tab");
    const charmPart = ahri.getByRole("button", { name: "Charm" });
    await expect(charmPart).toBeFocused();
    const charm = layer(page, "Charm").filter({ hasText: "Ahri's E" });
    const keyword = layer(page, "Charm").filter({ hasText: "Crowd control" });
    await expect(charm).toBeVisible();

    // Enter moves focus into that layer, onto the keyword it contains. The
    // keyword's own layer opens beside it as it takes focus.
    const charms = charm.getByRole("button", { name: "Charms" });
    await expect(charms).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(charms).toBeFocused();
    await expect(keyword).toBeVisible();

    // Escape closes only the top layer: the keyword's, then the ability's,
    // which puts focus back on its part.
    await page.keyboard.press("Escape");
    await expect(keyword).toHaveCount(0);
    await expect(charm).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(charm).toHaveCount(0);
    await expect(ahri).toBeVisible();
    await expect(charmPart).toBeFocused();

    // Focus returning to the part does not reopen its layer.
    await page.waitForTimeout(OPEN_DELAY + 100);
    await expect(charm).toHaveCount(0);

    // A last Escape closes the champion layer and returns to the trigger.
    await page.keyboard.press("Escape");
    await expect(ahri).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a tap opens a bottom sheet, a tapped part replaces its content, back returns", async ({
    page,
  }) => {
    await page.goto(interactive);
    await page.getByRole("button", { name: "Ahri", exact: true }).tap();

    const sheet = page.getByRole("dialog", { name: "Ahri", exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("the Nine-Tailed Fox")).toBeVisible();
    // The sheet is a bottom sheet: full width, flush with the bottom edge.
    const box = await sheet.boundingBox();
    expect(box?.width).toBe(390);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(844, 0);

    // A part replaces the content with a back control.
    await sheet.getByRole("button", { name: "Charm" }).tap();
    const charm = page.getByRole("dialog", { name: "Charm", exact: true });
    await expect(charm.getByText("Ahri's E")).toBeVisible();
    const back = page.getByRole("button", { name: "Back to Ahri" });
    await expect(back).toBeVisible();

    // And again, down to the keyword, then back out one step at a time.
    await charm.getByRole("button", { name: "Charms" }).tap();
    await expect(
      page.getByRole("button", { name: "Back to Charm" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to Charm" }).tap();
    await expect(page.getByText("Ahri's E")).toBeVisible();
    await page.getByRole("button", { name: "Back to Ahri" }).tap();
    await expect(page.getByText("the Nine-Tailed Fox")).toBeVisible();

    // Closing returns focus to the trigger.
    await page.getByRole("button", { name: "Close" }).tap();
    await expect(sheet).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Ahri", exact: true }),
    ).toBeFocused();
  });
});
