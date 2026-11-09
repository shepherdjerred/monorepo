import type { PromotionTarget } from "#shared/promotion.ts";
import { PromotionBrowser } from "#activities/promotion/browser.ts";
import { promotionObservationText } from "./observation.ts";

export function publicRedditReceiptUrl(address: string) {
  const url = new URL(address);
  if (
    !["old.reddit.com", "www.reddit.com"].includes(url.hostname) ||
    !url.pathname.includes("/comments/")
  )
    throw new Error("Public verification requires a Reddit post permalink");
  url.hostname = "www.reddit.com";
  url.search = "";
  url.hash = "";
  return url.href;
}

/** A new browser profile has no account session: author-only visibility is insufficient. */
export async function capturePublicRedditReceipt(input: {
  target: PromotionTarget;
  url: string;
  baseUrl: string;
  token: string;
  signal: AbortSignal;
  saveEvidence: (bytes: Uint8Array) => Promise<string>;
  expectedQuote: string;
}) {
  const browser = new PromotionBrowser(
    input.target,
    input.baseUrl,
    input.token,
    {
      signal: input.signal,
      temporaryProfile: true,
    },
  );
  try {
    await browser.open(publicRedditReceiptUrl(input.url));
    const deadline = Date.now() + 15_000;
    for (;;) {
      const page = await browser
        .snapshot({ selector: "shreddit-post" })
        .catch((error: unknown) => {
          if (
            String(error).includes("selector matched no element") &&
            Date.now() < deadline
          )
            return null;
          throw error;
        });
      if (page === null) {
        await Bun.sleep(250);
        continue;
      }
      if (
        (page.publishedAt !== null &&
          promotionObservationText(page.text).includes(input.expectedQuote)) ||
        /\[removed\]|removed by|awaiting moderator|pending approval/i.test(
          page.text,
        )
      ) {
        const screenshotKey = await input.saveEvidence(
          await browser.screenshot(),
        );
        return {
          ...page,
          url: publicRedditReceiptUrl(page.url),
          screenshotKey,
        };
      }
      if (Date.now() >= deadline)
        throw new Error(
          "Anonymous Reddit verification did not render a post or moderation result",
        );
      await Bun.sleep(250);
    }
  } finally {
    await browser.close();
  }
}
