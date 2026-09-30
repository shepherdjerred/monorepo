import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import type { DiscoveryService } from "@shepherdjerred/streambot/discovery/discovery-service.ts";
import {
  inferMediaIntent,
  type MediaIntent,
} from "@shepherdjerred/streambot/discovery/media-intent.ts";
import { pickOfficialSameWork } from "@shepherdjerred/streambot/discovery/same-work.ts";

export async function searchMediaText(input: {
  readonly query: string;
  readonly source: MediaIntent["source"];
  readonly scope: DiscoveryScope | null;
  readonly discovery: DiscoveryService | undefined;
  readonly signal: AbortSignal;
  readonly libraryFallback: () => string;
  readonly onAmbiguous: () => void;
}): Promise<string> {
  const { scope, discovery } = input;
  if (scope === null || discovery === undefined) return input.libraryFallback();
  const matches = await discovery.search(
    inferMediaIntent({ query: input.query, source: input.source }),
    scope,
    input.signal,
  );
  if (matches.length === 0) return "I couldn't find any matching media.";
  discovery.rememberCandidates(scope, matches);
  const official = pickOfficialSameWork(matches);
  if (official !== undefined) {
    return `These matches are the same work. Play this official/best match: ${official.title}.`;
  }
  if (matches.length > 1) input.onAmbiguous();
  return matches
    .map(
      (candidate, index) =>
        `${String(index + 1)}. ${candidate.title}, ${candidate.reason}`,
    )
    .join("; ");
}
