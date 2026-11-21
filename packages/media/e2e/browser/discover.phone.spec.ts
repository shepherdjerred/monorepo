import { expect } from "@playwright/test";
import { openAs, test } from "./support.ts";

/*
 * What a row on Discover is on a phone: swiped, with the next card showing at
 * the edge of the screen, and no buttons a finger does not need.
 */

test("a row is swiped: no buttons, and the next card shows at the screen's edge", async ({
  page,
}) => {
  await openAs(page, "member", "/discover");
  await page.waitForLoadState("networkidle");
  const list = page.getByRole("list", { name: "Popular films", exact: true });
  await expect(list.getByRole("listitem")).toHaveCount(20);
  await expect(
    page.getByRole("button", { name: /^Scroll (back|forward):/u }),
  ).toHaveCount(0);

  const width = page.viewportSize()?.width ?? 0;
  const boxes = await list.evaluate((element) =>
    [...element.children].slice(0, 3).map((card) => {
      const box = card.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }),
  );
  const [first, second, third] = boxes;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error("The row has fewer than three cards");
  }
  // Two whole cards, and part of a third running off the screen.
  expect(first.left).toBe(16);
  expect(second.right).toBeLessThan(width);
  expect(third.left).toBeLessThan(width);
  expect(third.right).toBeGreaterThan(width);
  // The row reaches the edge of the screen; the page itself does not scroll.
  expect(
    await list.evaluate((element) => element.getBoundingClientRect().right),
  ).toBe(width);
  expect(
    await page
      .locator("html")
      .evaluate((root) => root.scrollWidth - root.clientWidth),
  ).toBe(0);

  // The search field puts the keyboard away once a search is sent.
  const search = page.getByRole("searchbox", {
    name: "Search films and series",
  });
  await search.fill("dune");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/discover\?q=dune$/u);
  await expect(search).not.toBeFocused();
});
