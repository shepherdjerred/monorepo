import { expect } from "@playwright/test";
import { openAs, test } from "./support.ts";

/*
 * What a row on Discover offers a mouse: a button at each end, because a
 * wheel only scrolls the page.
 */

test("a row's buttons page through it, and an end hands focus to the other one", async ({
  page,
}) => {
  await openAs(page, "member", "/discover");
  await page.waitForLoadState("networkidle");
  const list = page.getByRole("list", { name: "Popular films", exact: true });
  // A button with nowhere to go is hidden as well as disabled.
  const back = page.getByRole("button", {
    name: "Scroll back: Popular films",
    includeHidden: true,
  });
  const forward = page.getByRole("button", {
    name: "Scroll forward: Popular films",
    includeHidden: true,
  });
  const scrolled = async () =>
    list.evaluate((element) => Math.round(element.scrollLeft));
  /** Presses Enter on the focused button and waits for the row to rest. */
  const turn = async () => {
    const from = await scrolled();
    await page.keyboard.press("Enter");
    await expect.poll(scrolled).not.toBe(from);
    let last = from;
    await expect
      .poll(async () => {
        const now = await scrolled();
        const resting = now === last;
        last = now;
        return resting;
      })
      .toBe(true);
  };

  // At the start there is nowhere to go back to.
  await expect(back).toBeDisabled();
  await expect(back).toBeHidden();
  await expect(forward).toBeEnabled();

  await forward.click();
  await expect.poll(scrolled).toBeGreaterThan(0);
  await expect(back).toBeEnabled();
  // The row rests on a card, level with the page's margin.
  const margin = await page
    .getByRole("heading", { level: 2, name: "Popular films" })
    .evaluate((heading) => heading.getBoundingClientRect().left);
  await expect
    .poll(async () =>
      list.evaluate((element, edge) => {
        const lefts = [...element.children].map(
          (card) => card.getBoundingClientRect().left,
        );
        return lefts.some((left) => Math.abs(left - edge) < 1);
      }, margin),
    )
    .toBe(true);

  // Forward to the end: the button goes, and the keyboard is not stranded.
  await forward.focus();
  for (let presses = 0; presses < 12; presses += 1) {
    if (await forward.isDisabled()) break;
    await turn();
  }
  await expect(forward).toBeDisabled();
  await expect(back).toBeFocused();
  await expect(
    list.getByRole("listitem").last().getByRole("link"),
  ).toBeInViewport();

  // And back again.
  for (let presses = 0; presses < 12; presses += 1) {
    if (await back.isDisabled()) break;
    await turn();
  }
  await expect(back).toBeDisabled();
  await expect(forward).toBeFocused();
  expect(await scrolled()).toBe(0);
});
