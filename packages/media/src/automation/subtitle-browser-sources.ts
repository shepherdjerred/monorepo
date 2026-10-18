import {
  SubhdProvider,
  ZimukuProvider,
} from "#integrations/browser-subtitles.ts";
import { IntegrationError } from "#integrations/http.ts";
import {
  cleanupSubtitleBrowser,
  readBrowserState,
  saveBrowserState,
  subtitleBrowser,
  type SubtitleBrowserState,
} from "./subtitle-browser-lifecycle.ts";
import type { MediaAutomationContext } from "./context.ts";
import {
  claimSubtitleDownload,
  subtitleArchive,
  subtitleVersionMatches,
  requireUntargetedProvider,
  type SubtitleSearch,
  type SubtitleSource,
} from "./subtitle-sources.ts";

export type SubtitleLookup = SubtitleSource | null | { pending: true };

function requireResumableBrowser(
  state: SubtitleBrowserState | undefined,
  binding: string,
): void {
  if (
    state !== undefined &&
    (state.binding !== binding || !["prepare", "resolve"].includes(state.phase))
  )
    throw new IntegrationError(
      "subtitle-browser",
      state.phase === "closed" ? "interaction-required" : "outcome-unknown",
    );
}

export async function fromSubhd(
  context: Pick<MediaAutomationContext, "db" | "cipher">,
  input: SubtitleSearch,
  ports?: {
    provider: Pick<SubhdProvider, "search" | "downloadAuthorized">;
    browser: Pick<
      Awaited<ReturnType<typeof subtitleBrowser>>,
      "openSubhd" | "prepareSubhd" | "resolveSubhd" | "close"
    >;
  },
): Promise<SubtitleLookup> {
  if (!["zh-Hans", "zh-CN"].includes(input.language)) return null;
  requireUntargetedProvider(input, "subhd");
  const provider = ports?.provider ?? new SubhdProvider();
  const browser = ports?.browser ?? (await subtitleBrowser(context));
  let state = await readBrowserState(context, input.operationId);
  const binding = `${input.language}:${input.sourceFilename}`;
  requireResumableBrowser(state, binding);
  if (state === undefined) {
    const found = await provider.search(input.query);
    const candidates = found.filter((candidate) =>
      subtitleVersionMatches(candidate.release, input.sourceFilename),
    );
    if (candidates.length !== 1 || candidates[0] === undefined) return null;
    const candidate = candidates[0];
    state = {
      tabId: null,
      subtitleId: candidate.id,
      phase: "opening",
      description: `${candidate.provenance} ${candidate.release}`,
      binding,
    };
    await saveBrowserState(context, input.operationId, state);
    const tabId = await browser.openSubhd(candidate.id);
    state = { ...state, tabId, phase: "prepare" };
    try {
      await saveBrowserState(context, input.operationId, state);
    } catch (error) {
      await browser.close(tabId);
      throw error;
    }
  }
  if (state.tabId === null)
    throw new IntegrationError("subtitle-browser", "outcome-unknown");
  let pending = false;
  try {
    if (state.phase === "prepare") {
      if (
        (await browser.prepareSubhd(state.tabId, state.subtitleId)) ===
        "loading"
      ) {
        pending = true;
        return { pending: true };
      }
      await saveBrowserState(context, input.operationId, {
        ...state,
        phase: "resolve",
      });
      pending = true;
      return { pending: true };
    }
    const subtitleId = state.subtitleId;
    const resolved = await browser.resolveSubhd(
      state.tabId,
      subtitleId,
      undefined,
      async () => {
        await claimSubtitleDownload(context, input, "subhd", subtitleId);
      },
    );
    if (resolved.status === "loading") {
      pending = true;
      return { pending: true };
    }
    return await subtitleArchive(
      await provider.downloadAuthorized(resolved.url),
      input,
      state.description,
    );
  } finally {
    if (!pending)
      await cleanupSubtitleBrowser(
        context,
        input.operationId,
        "lookup_finished",
        browser,
      );
  }
}

export async function fromZimuku(
  context: MediaAutomationContext,
  input: SubtitleSearch,
): Promise<SubtitleLookup> {
  if (!["zh-Hans", "zh-CN"].includes(input.language)) return null;
  requireUntargetedProvider(input, "zimuku");
  const provider = new ZimukuProvider();
  const pages = await provider.search(input.query);
  for (const page of pages.slice(0, 3)) {
    const found = await provider.candidates(page.pageUrl);
    const candidates = found.filter(
      (candidate) =>
        candidate.simplifiedLabel &&
        subtitleVersionMatches(candidate.release, input.sourceFilename),
    );
    if (candidates.length !== 1 || candidates[0] === undefined) continue;
    const candidate = candidates[0];
    await claimSubtitleDownload(context, input, "zimuku", candidate.id);
    return await subtitleArchive(
      await provider.download(candidate.pageUrl),
      input,
      candidate.release,
    );
  }
  return null;
}
