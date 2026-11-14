import { Subf2mProvider } from "#integrations/subf2m/client.ts";
import { IntegrationError, type FetchTransport } from "#integrations/http.ts";
import {
  claimSubtitleDownload,
  subtitleArchive,
  subtitleVersionMatches,
} from "#automation/subtitle-sources.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import {
  subtitleProviderCandidateAllowedV1,
  type SubtitleSearch,
} from "#domain/subtitle-maintenance/provider.ts";

export async function fromSubf2m(
  context: MediaAutomationContext,
  input: SubtitleSearch,
  transport?: FetchTransport,
) {
  if (input.language !== "en") return null;
  if (
    input.forced === true ||
    (input.hearingImpaired !== undefined && input.hearingImpaired !== "any")
  )
    throw new IntegrationError("subf2m", "unsupported-target");
  if (input.scoreReferenceV1 === undefined)
    throw new IntegrationError("subf2m", "unsupported-target");
  const provider = new Subf2mProvider(transport);
  const candidates = await provider.search(input.scoreReferenceV1);
  const selected = candidates.find(
    (candidate) =>
      subtitleVersionMatches(candidate.release, input.sourceFilename) &&
      subtitleProviderCandidateAllowedV1(input, "subf2m", candidate.page),
  );
  if (selected === undefined) return null;
  await claimSubtitleDownload(context, input, "subf2m", selected.page);
  return subtitleArchive(
    await provider.download(selected.page),
    input,
    `${selected.release} ${selected.description}`,
  );
}
