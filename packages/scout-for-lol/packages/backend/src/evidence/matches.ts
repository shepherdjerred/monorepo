import { matchDataSourceOf, type RawMatch } from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { prisma } from "#src/database/index.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { storedRawArchiveDescriptor } from "#src/report-lake/durable-receipts.ts";
import { readArchivedMatchPayload } from "#src/report-lake/receipted-archive.ts";
import {
  readSelectedLocalCanonicalMatch,
  readLocalCanonicalCandidates,
  selectLocalCanonicalMatch,
  localCanonicalMatchesAgree,
} from "#src/scout-client/canonical-match.ts";
import {
  expectedRiotAbsenceStatuses,
  optionalSourceRead,
  readSource,
  riotAbsenceOf,
  type EvidenceResolution,
} from "./source-read.ts";
import { enrichCompleteMatch } from "./complete-match-policy.ts";

function available(
  match: RawMatch,
  sourceId: string,
  frozen: boolean,
): EvidenceResolution<RawMatch> {
  return {
    kind: "available",
    value: match,
    coverage: "complete",
    frozen,
    evidence: [{ source: matchDataSourceOf(match.metadata), sourceId }],
  };
}

/** The only complete-match selection boundary. Consumers never fetch a source. */
export async function resolveCompleteMatch(
  matchId: RiotMatchId,
): Promise<EvidenceResolution<RawMatch>> {
  const archive = await storedRawArchiveDescriptor(prisma, matchId, "match");
  if (archive !== null)
    return available(
      await readArchivedMatchPayload(archive, matchId),
      archive.key,
      true,
    );
  // Compatibility with selections committed by the previous release. Their
  // input was already promised to processing and must not change on deploy.
  const selected = await readSelectedLocalCanonicalMatch(matchId);
  if (selected !== null) return available(selected, matchId, true);
  const [riotRead, local] = await Promise.all([
    readSource("RIOT", () =>
      fetchMatchData(
        matchId,
        platformRouteOf(matchId),
        "return_undefined_on_404",
        expectedRiotAbsenceStatuses(),
      ),
    ),
    optionalSourceRead("SCOUT_CLIENT", () =>
      readLocalCanonicalCandidates(matchId),
    ),
  ]);
  const riot = riotRead.kind === "read" ? riotRead.value : undefined;
  if (riot !== undefined) {
    const resolved = available(
      enrichCompleteMatch(
        riot,
        (local ?? []).map((entry) => entry.match),
      ),
      matchId,
      false,
    );
    return resolved.kind === "available"
      ? {
          ...resolved,
          evidence: [
            ...resolved.evidence,
            ...(local ?? []).map((entry) => ({
              source: "SCOUT_CLIENT" as const,
              sourceId: entry.candidate.observationId,
            })),
          ],
        }
      : resolved;
  }
  if (local === undefined || local.length === 0)
    return {
      kind: "unavailable",
      reason: "No complete compatible match evidence",
      // A failed client read leaves the answer open even when Riot refused.
      definitiveAbsence:
        local === undefined ? undefined : riotAbsenceOf(riotRead),
    };
  const ready = local.filter(
    (entry) => entry.eligibleAt.getTime() <= Date.now(),
  );
  if (ready.length === 0)
    return {
      kind: "pending",
      retryAt: new Date(
        Math.min(...local.map((entry) => entry.eligibleAt.getTime())),
      ).toISOString(),
    };
  const selectedCandidate = ready[0];
  if (selectedCandidate === undefined)
    throw new Error("A selected client match must have eligible evidence");
  if (
    !ready.every((entry) =>
      localCanonicalMatchesAgree(selectedCandidate.match, entry.match),
    )
  )
    return {
      kind: "conflict",
      evidence: ready.map((entry) => ({
        source: "SCOUT_CLIENT",
        sourceId: entry.candidate.observationId,
      })),
    };
  const match = await selectLocalCanonicalMatch(matchId, ready);
  return available(match, selectedCandidate.candidate.observationId, true);
}
