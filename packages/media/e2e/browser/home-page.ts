import type { Page } from "@playwright/test";

/*
 * What the Home specs share: the page's sections in order, and how to find
 * them.
 */

export const SECTIONS = [
  "Needs your answer",
  "Now playing",
  "On the way",
  "New in the library",
  "This week",
  "Leaving soon",
] as const;

export const main = (page: Page) => page.locator("#main");
export const sectionHeadings = (page: Page) =>
  main(page).getByRole("heading", { level: 2 });
export const list = (page: Page, name: string) =>
  main(page).getByRole("list", { name, exact: true });
