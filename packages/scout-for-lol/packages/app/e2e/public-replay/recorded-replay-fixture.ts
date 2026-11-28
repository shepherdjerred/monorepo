import { expect, type Page } from "@playwright/test";
import { readRecordedDraw } from "./recorded-draw-probe.ts";
import {
  apiPath,
  packagePrefix,
  type readRecordedReplay,
} from "./recorded-replay-data.ts";

export async function observeRecordedReplayRequests(
  page: Page,
  origin: string,
) {
  const requested = new Set<string>();
  const credentialed = new Set<string>();
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    const { pathname } = url;
    if (pathname.startsWith(apiPath) || pathname.startsWith(packagePrefix)) {
      requested.add(pathname);
      const headers = await request.allHeaders();
      if ("cookie" in headers || "authorization" in headers)
        credentialed.add(pathname);
    }
    return route.continue();
  });
  return { requested, credentialed };
}

export async function seek(page: Page, seconds: number) {
  const slider = page.getByRole("slider", { name: "Replay time" });
  await slider.evaluate((element, target) => {
    const value = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    if (value?.set === undefined)
      throw new Error("Missing range input setter.");
    value.set.call(element, target);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, String(seconds));
  await expect(slider).toHaveValue(String(seconds));
  await expect(slider).toHaveAttribute("aria-busy", "false");
}

export async function verifyRecordedParticlePreview(
  page: Page,
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
) {
  if (fixture.particlePreview === undefined) return;
  const vision = page.getByRole("combobox", { name: "Unit visibility" });
  const count = async () => {
    const draw = await readRecordedDraw(page);
    return draw.recordedParticleDraws;
  };
  const expectAt = async (seconds: number, draws: number) => {
    await seek(page, seconds);
    await expect.poll(count).toBe(draws);
  };
  await vision.selectOption("all");
  await expectAt(2094.9, 0);
  // Two detached impacts with two authored components each.
  await expectAt(2095.2, 4);
  await vision.selectOption("blue");
  await expect.poll(count).toBe(0);
  await vision.selectOption("all");
  await expect.poll(count).toBe(4);
  await expectAt(2095.6, 0);
  await expectAt(2095.2, 4);
  await expectAt(2094.9, 0);
}
