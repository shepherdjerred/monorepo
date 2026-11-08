import { z } from "zod";
import { PinchTabSubtitleBrowser } from "#integrations/browser-subtitles.ts";
import { IntegrationError } from "#integrations/http.ts";
import type { MediaAutomationContext } from "./context.ts";
import { subtitleCredential } from "./subtitle-sources.ts";
type BrowserContext = Pick<MediaAutomationContext, "db" | "cipher">;

export const SubtitleBrowserStateSchema = z.object({
  tabId: z.string().nullable(),
  subtitleId: z.string(),
  description: z.string(),
  binding: z.string(),
  phase: z.enum([
    "opening",
    "prepare",
    "resolve",
    "closing",
    "closed",
    "open_unknown",
    "close_unknown",
  ]),
  reason: z.string().optional(),
});
export type SubtitleBrowserState = z.infer<typeof SubtitleBrowserStateSchema>;

export async function subtitleBrowser(context: BrowserContext) {
  const credential = z
    .object({ baseUrl: z.url(), token: z.string(), instanceId: z.string() })
    .parse(await subtitleCredential(context, "subhd"));
  return new PinchTabSubtitleBrowser(credential);
}

export async function readBrowserState(
  context: BrowserContext,
  operationId: string,
) {
  const operation = await context.db.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  return z
    .object({ subtitleBrowser: SubtitleBrowserStateSchema.optional() })
    .parse(operation.result ?? {}).subtitleBrowser;
}

export async function saveBrowserState(
  context: BrowserContext,
  operationId: string,
  state: SubtitleBrowserState,
): Promise<void> {
  const changed = await context.db
    .$executeRaw`UPDATE "Operation" SET result = COALESCE(result, '{}'::jsonb) || ${JSON.stringify({ subtitleBrowser: state })}::jsonb, "updatedAt" = NOW() WHERE id = ${operationId}`;
  if (changed !== 1) throw new Error("Subtitle browser operation disappeared");
}

/** May be retried: closes only a journal-owned tab; unknown opens remain an explicit intervention. */
export async function cleanupSubtitleBrowser(
  context: BrowserContext,
  operationId: string,
  reason: string,
  suppliedBrowser?: Pick<PinchTabSubtitleBrowser, "close">,
): Promise<void> {
  const state = await readBrowserState(context, operationId);
  if (state === undefined || state.phase === "closed") return;
  if (state.tabId === null) {
    await saveBrowserState(context, operationId, {
      ...state,
      phase: "open_unknown",
      reason: "browser_open_requires_review",
    });
    throw new IntegrationError("subtitle-browser", "outcome-unknown");
  }
  const browser = suppliedBrowser ?? (await subtitleBrowser(context));
  await saveBrowserState(context, operationId, {
    ...state,
    phase: "closing",
    reason,
  });
  try {
    await browser.close(state.tabId);
    await saveBrowserState(context, operationId, {
      ...state,
      phase: "closed",
      reason,
    });
  } catch {
    await saveBrowserState(context, operationId, {
      ...state,
      phase: "close_unknown",
      reason: "browser_close_requires_review",
    });
    throw new IntegrationError("subtitle-browser", "outcome-unknown");
  }
}
