import {
  matchCoverageOf,
  matchDataSourceOf,
  riotWithholdsMatchResult,
  type CanonicalMatch,
  type CanonicalMatchRecord,
  type RawMatch,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { prisma } from "#src/database/index.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { storedRawArchiveDescriptor } from "#src/report-lake/durable-receipts.ts";
import { readArchivedCanonicalMatch } from "#src/report-lake/receipted-archive.ts";
import {
  readSelectedCanonicalMatch,
  readLocalCanonicalCandidates,
  readLocalEndOfGameCandidates,
  selectLocalCanonicalMatch,
  selectLocalEndOfGameMatch,
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

/** How soon to look again when Riot's answer is still open. */
const RIOT_UNDECIDED_RETRY_MS = 60_000;

function available<T extends CanonicalMatch>(
  match: T,
  sourceId: string,
  frozen: boolean,
): EvidenceResolution<T> {
  return {
    kind: "available",
    value: match,
    coverage:
      matchCoverageOf(match.metadata) === "end_of_game"
        ? "partial"
        : "complete",
    frozen,
    evidence: [{ source: matchDataSourceOf(match.metadata), sourceId }],
  };
}

/**
 * The canonical match already fixed for this game, of either coverage: the
 * archived document, or else a selection committed earlier. Either one is
 * immutable, so no later evidence replaces it.
 */
async function frozenCanonicalMatch(
  matchId: RiotMatchId,
): Promise<(CanonicalMatchRecord & { sourceId: string }) | null> {
  const archive = await storedRawArchiveDescriptor(prisma, matchId, "match");
  if (archive !== null)
    return {
      ...(await readArchivedCanonicalMatch(archive, matchId)),
      sourceId: archive.key,
    };
  // Compatibility with selections committed by the previous release. Their
  // input was already promised to processing and must not change on deploy.
  const selected = await readSelectedCanonicalMatch(matchId);
  return selected === null
    ? null
    : { ...selected, sourceId: selected.observationId };
}

/** The only complete-match selection boundary. Consumers never fetch a source. */
export async function resolveCompleteMatch(
  matchId: RiotMatchId,
): Promise<EvidenceResolution<RawMatch>> {
  const frozen = await frozenCanonicalMatch(matchId);
  if (frozen === null) return await resolveOpenCompleteMatch(matchId);
  // An end-of-game record is final too: this game never gets a complete one.
  return frozen.coverage === "complete"
    ? available(frozen.match, frozen.sourceId, true)
    : {
        kind: "unavailable",
        reason: "The game is frozen as an end-of-game record",
        definitiveAbsence: undefined,
      };
}

/** Complete-match selection for a game nothing has frozen yet. */
async function resolveOpenCompleteMatch(
  matchId: RiotMatchId,
): Promise<EvidenceResolution<RawMatch>> {
  const [riotRead, local] = await Promise.all([
    readSource("RIOT", () =>
      fetchMatchData(
        matchId,
        platformRouteOf(matchId),
        "return_undefined_on_404",
        { expectedAbsenceStatuses: expectedRiotAbsenceStatuses() },
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

/**
 * The canonical match for a game, of either coverage. A complete match wins
 * whenever one exists: Riot's, or a paired client's history bundle. Only when
 * there is none does an end-of-game record stand in, and only after
 *
 * - its deadline, so the game's bundle and pending aliases can still arrive;
 * - Riot's answer is definitive, unless this game is one Riot never
 *   publishes: an outage must not freeze a game Riot will publish as partial.
 *
 * Disagreeing end-of-game records are a conflict and produce no record.
 * Whatever is selected is frozen in the same selection row a bundle uses,
 * with its observation (and so its device) as provenance, and never upgraded.
 */
export async function resolveCanonicalMatch(
  matchId: RiotMatchId,
  now = new Date(),
): Promise<EvidenceResolution<CanonicalMatch>> {
  const frozen = await frozenCanonicalMatch(matchId);
  if (frozen !== null) return available(frozen.match, frozen.sourceId, true);
  const complete = await resolveOpenCompleteMatch(matchId);
  if (complete.kind !== "unavailable") return complete;
  const endOfGame = await optionalSourceRead("SCOUT_CLIENT", () =>
    readLocalEndOfGameCandidates(matchId),
  );
  if (endOfGame === undefined || endOfGame.length === 0) return complete;
  const evidence = endOfGame.map((entry) => ({
    source: "SCOUT_CLIENT" as const,
    sourceId: entry.candidate.observationId,
  }));
  const [first] = endOfGame;
  if (
    first !== undefined &&
    endOfGame.some(
      (entry) => !localCanonicalMatchesAgree(first.match, entry.match),
    )
  )
    return { kind: "conflict", evidence };
  if (
    complete.definitiveAbsence === undefined &&
    !endOfGame.every((entry) => riotWithholdsMatchResult(entry.match.info))
  )
    return {
      kind: "pending",
      retryAt: new Date(now.getTime() + RIOT_UNDECIDED_RETRY_MS).toISOString(),
    };
  if (!endOfGame.some((entry) => entry.eligibleAt <= now))
    return {
      kind: "pending",
      retryAt: new Date(
        Math.min(...endOfGame.map((entry) => entry.eligibleAt.getTime())),
      ).toISOString(),
    };
  // Read back from the selection row, which a racing writer may have filled.
  const selected = await selectLocalEndOfGameMatch(matchId, endOfGame, now);
  return available(selected.match, selected.observationId, true);
}
