import { z } from "zod";
import {
  SubhdProvider,
  PinchTabSubtitleBrowser,
  ZimukuProvider,
} from "#integrations/browser-subtitles.ts";
import type { MediaAutomationContext } from "./context.ts";
import {
  claimSubtitleDownload,
  subtitleArchive,
  subtitleCredential,
  subtitleVersionMatches,
  type SubtitleSearch,
  type SubtitleSource,
} from "./subtitle-sources.ts";

export type SubtitleLookup = SubtitleSource | null | { pending: true };
const BrowserStateSchema = z.object({
  subtitleBrowser: z
    .object({
      tabId: z.string(),
      subtitleId: z.string(),
      phase: z.enum(["prepare", "resolve"]),
      description: z.string(),
    })
    .optional(),
});

export async function fromSubhd(
  context: MediaAutomationContext,
  input: SubtitleSearch,
): Promise<SubtitleLookup> {
  if (!["zh-Hans", "zh-CN"].includes(input.language)) return null;
  const credential = z
    .object({ baseUrl: z.url(), token: z.string(), instanceId: z.string() })
    .parse(await subtitleCredential(context, "subhd"));
  const provider = new SubhdProvider();
  const browser = new PinchTabSubtitleBrowser(credential);
  const operation = await context.db.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  let state = BrowserStateSchema.parse(operation.result ?? {}).subtitleBrowser;
  if (state === undefined) {
    const found = await provider.search(input.query);
    const candidates = found.filter((candidate) =>
      subtitleVersionMatches(candidate.release, input.sourceFilename),
    );
    if (candidates.length !== 1 || candidates[0] === undefined) return null;
    const candidate = candidates[0];
    state = {
      tabId: await browser.openSubhd(candidate.id),
      subtitleId: candidate.id,
      phase: "prepare",
      description: `${candidate.provenance} ${candidate.release}`,
    };
    await context.db.operation.update({
      where: { id: input.operationId },
      data: { result: { subtitleBrowser: state } },
    });
  }
  if (state.phase === "prepare") {
    if (
      (await browser.prepareSubhd(state.tabId, state.subtitleId)) === "loading"
    )
      return { pending: true };
    await context.db.operation.update({
      where: { id: input.operationId },
      data: { result: { subtitleBrowser: { ...state, phase: "resolve" } } },
    });
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
  if (resolved.status === "loading") return { pending: true };
  try {
    return await subtitleArchive(
      await provider.downloadAuthorized(resolved.url),
      input,
      state.description,
    );
  } finally {
    await browser.close(state.tabId);
  }
}

export async function fromZimuku(
  context: MediaAutomationContext,
  input: SubtitleSearch,
): Promise<SubtitleLookup> {
  if (!["zh-Hans", "zh-CN"].includes(input.language)) return null;
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
