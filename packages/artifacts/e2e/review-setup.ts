import { expect, type Page } from "@playwright/test";
import { agentActor, createApiClient } from "./client.ts";
import { generateFixtures, type Fixtures } from "./fixtures.ts";
import { seedBoard, type SeededBoards } from "./seed.ts";

let fixtures: Promise<Fixtures> | undefined;

/** Fixtures are generated once per process; ffmpeg makes them slow. */
export function sharedFixtures(): Promise<Fixtures> {
  fixtures ??= generateFixtures();
  return fixtures;
}

/** Empties the fake service and publishes one of each kind through the upload API. */
export async function resetAndSeed(
  baseURL: string | undefined,
): Promise<SeededBoards> {
  if (baseURL === undefined) throw new Error("baseURL is not configured");
  const response = await fetch(`${baseURL}/api/_e2e/reset`, { method: "POST" });
  expect(response.status).toBe(204);
  return seedBoard(baseURL, await sharedFixtures());
}

/** Reads a stream to its end, ignoring the abort that closes it. */
export async function drain(body: ReadableStream | null): Promise<void> {
  try {
    await body?.pipeTo(new WritableStream());
  } catch {
    return;
  }
}

export const KARPATHY = agentActor("karpathy");

export function agentApi(baseURL: string | undefined) {
  if (baseURL === undefined) throw new Error("baseURL is not configured");
  return createApiClient(baseURL, KARPATHY);
}

export type Focused = {
  tag: string;
  label: string;
  text: string;
  inThread: string;
};

/**
 * Presses Tab (Shift+Tab backwards) until the focused element satisfies
 * `matches`; fails after `limit` presses. Safari only tabs to every control
 * with Option held, so WebKit uses Alt.
 */
export async function tabTo(
  page: Page,
  matches: (element: Focused) => boolean,
  options: { backward?: boolean; limit?: number } = {},
): Promise<void> {
  const webkit = page.context().browser()?.browserType().name() === "webkit";
  const chord = `${webkit ? "Alt+" : ""}${options.backward === true ? "Shift+" : ""}Tab`;
  for (let press = 0; press < (options.limit ?? 80); press += 1) {
    await page.keyboard.press(chord);
    const focused = await page.locator(":focus").evaluate((element) => {
      const labelled = element.getAttribute("aria-label");
      const byId =
        element.id === ""
          ? null
          : element.ownerDocument.querySelector(`label[for="${element.id}"]`);
      return {
        tag: element.tagName,
        label: labelled ?? byId?.textContent ?? "",
        text: element.textContent.trim(),
        inThread: element.closest("[data-testid=thread]")?.textContent ?? "",
      };
    });
    if (matches(focused)) return;
  }
  throw new Error("Tab never reached the expected element");
}

/** Opens the comments panel when it is collapsed (a phone starts with it collapsed). */
export async function openPanel(page: Page): Promise<void> {
  const toggle = page.getByTestId("panel-toggle");
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
  await expect(page.getByRole("region", { name: "Comments" })).toBeVisible();
}

export async function openFocused(
  page: Page,
  artifactId: string,
  version?: number,
): Promise<void> {
  await page.goto(
    `/a/${artifactId}${version === undefined ? "" : `?v=${String(version)}`}`,
  );
  // A phone's sheet starts collapsed and would cover the viewer; wide screens show the panel.
  await expect(
    page.getByTestId("floating-nav").getByRole("heading", { level: 1 }),
  ).toBeVisible();
  const width = page.viewportSize()?.width ?? 0;
  if (width > 900) await openPanel(page);
}

export async function commentWithMode(page: Page, text: string): Promise<void> {
  const composer = page.getByTestId("placement-composer");
  await expect(composer).toBeVisible();
  await composer.getByRole("textbox").fill(text);
  await composer.getByRole("button", { name: "Comment" }).click();
  await expect(composer).toBeHidden();
}

/** Presses C and waits until comment mode is on, so the next click places a pin. */
export async function enterCommentMode(page: Page): Promise<void> {
  await page.keyboard.press("c");
  await expect(page.getByTestId("comment-mode")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

/** Shows version `number` of the focused artifact: the pill's select, or the overflow menu on a phone. */
export async function selectVersion(page: Page, number: number): Promise<void> {
  const width = page.viewportSize()?.width ?? 0;
  if (width > 640) {
    await page
      .getByRole("combobox", { name: "Version" })
      .selectOption(String(number));
    return;
  }
  await page.getByRole("button", { name: "More" }).click();
  await page
    .getByRole("menuitem", {
      name: new RegExp(`^Version v${String(number)}`, "u"),
    })
    .click();
}
