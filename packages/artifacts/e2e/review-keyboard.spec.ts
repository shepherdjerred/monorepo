import { expect, test } from "@playwright/test";
import { openFocused, openPanel, resetAndSeed, tabTo } from "./review-setup.ts";
import type { SeededBoards } from "./seed.ts";

let seeded: SeededBoards;

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(120_000);
  seeded = await resetAndSeed(baseURL);
});

test.describe("keyboard", () => {
  test("the shortcut sheet opens with ? and closes with Escape", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("?");
    const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(sheet).toContainText("Comment mode");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("J and K walk threads, R replies, E resolves, brackets switch versions", async ({
    page,
  }) => {
    const artifactId = seeded.demo.htmlV2.artifactId;
    await openFocused(page, artifactId);
    await openPanel(page);
    for (const text of ["First note", "Second note"]) {
      await page.getByLabel("General comment").fill(text);
      await page
        .getByRole("button", { name: "Comment", exact: true })
        .last()
        .click();
      await expect(
        page.getByTestId("thread").filter({ hasText: text }),
      ).toBeVisible();
    }
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("j");
    await expect(page.getByTestId("thread").first()).toHaveAttribute(
      "data-selected",
      "true",
    );
    await page.keyboard.press("j");
    await expect(page.getByTestId("thread").nth(1)).toHaveAttribute(
      "data-selected",
      "true",
    );
    await page.keyboard.press("k");
    await expect(page.getByTestId("thread").first()).toHaveAttribute(
      "data-selected",
      "true",
    );
    await page.keyboard.press("r");
    await expect(
      page.getByTestId("thread").first().getByLabel("Reply"),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("e");
    await expect(
      page.getByTestId("thread").filter({ hasText: "First note" }),
    ).toBeHidden();

    await page.keyboard.press("[");
    await expect(page).toHaveURL(/v=1/u);
    if ((page.viewportSize()?.width ?? 0) > 640)
      await expect(page.getByRole("combobox", { name: "Version" })).toHaveValue(
        "1",
      );
    // The URL changes before the page re-renders with the version it names; the
    // next key must reach the handler of the new render, so let it commit.
    await page.waitForTimeout(250);
    await page.keyboard.press("]");
    await expect(page).toHaveURL(/v=2/u);
  });

  test("the whole review works from the outline with the keyboard alone", async ({
    page,
  }) => {
    await page.goto("/b/concepts");
    // Safari does not Tab to links without Option, which the helper adds.
    const webkit = page.context().browser()?.browserType().name() === "webkit";
    await page.keyboard.press(webkit ? "Alt+Tab" : "Tab");
    await expect(
      page.getByRole("link", { name: "Review this board as a list" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/b\/concepts\/outline/u);
    await expect(
      page.getByRole("heading", { name: "Concepts", level: 1 }),
    ).toBeVisible();

    await tabTo(page, (element) =>
      element.label.startsWith("Comment on Concept A"),
    );
    await page.keyboard.type("Keyboard-only feedback");
    await page.keyboard.press("Control+Enter");
    const thread = page
      .getByTestId("thread")
      .filter({ hasText: "Keyboard-only feedback" });
    await expect(thread).toBeVisible();

    await tabTo(
      page,
      (element) =>
        element.tag === "BUTTON" &&
        element.text === "Resolve" &&
        element.inThread.includes("Keyboard-only feedback"),
      { backward: true },
    );
    await page.keyboard.press("Enter");
    await expect(thread.getByRole("button", { name: "Reopen" })).toBeVisible();
  });
});
