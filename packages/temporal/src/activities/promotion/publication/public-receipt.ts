import type { PromotionTarget } from "#shared/promotion/model.ts";
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
  const parts = url.pathname.split("/").filter(Boolean);
  const commentId = parts[5];
  if (
    commentId !== undefined &&
    parts.length === 6 &&
    parts[0] === "r" &&
    parts[2] === "comments" &&
    /^[a-z0-9]+$/.test(commentId)
  ) {
    parts[4] = "comment";
    url.pathname = `/${parts.join("/")}/`;
  }
  url.search = "";
  url.hash = "";
  return url.href;
}

async function readRenderedRedditComment(browser: PromotionBrowser) {
  const deadline = Date.now() + 25_000;
  for (;;) {
    try {
      return await browser.readRedditCommentReceipt();
    } catch (error) {
      if (
        !String(error).includes("selector matched no element") ||
        Date.now() >= deadline
      )
        throw error;
      await Bun.sleep(250);
    }
  }
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
  beforeRedditNavigation?: (() => Promise<void>) | undefined;
}) {
  const browser = new PromotionBrowser(
    input.target,
    input.baseUrl,
    input.token,
    {
      signal: input.signal,
      temporaryProfile: true,
      ...(input.beforeRedditNavigation === undefined
        ? {}
        : { beforeRedditNavigation: input.beforeRedditNavigation }),
    },
  );
  try {
    const publicUrl = publicRedditReceiptUrl(input.url);
    await browser.open(publicUrl);
    if (input.target.action === "reply") {
      const page = await readRenderedRedditComment(browser);
      if (!promotionObservationText(page.text).includes(input.expectedQuote))
        throw new Error(
          "Anonymous Reddit reply verification did not render the selected comment",
        );
      const screenshotKey = await input.saveEvidence(
        await browser.screenshot(),
      );
      return { ...page, url: publicRedditReceiptUrl(page.url), screenshotKey };
    }
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
