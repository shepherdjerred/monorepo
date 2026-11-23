import { expect, type Page } from "@playwright/test";
import { apiPath, packagePrefix } from "./recorded-replay-data.ts";

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
