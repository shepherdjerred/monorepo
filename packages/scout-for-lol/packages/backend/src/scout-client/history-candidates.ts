import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { prisma } from "#src/database/index.ts";
import { scoutClientEndOfGameDeadlineSeconds } from "#src/config/dynamic.ts";
import { endOfGameEvidenceReadyAt } from "#src/evidence/source-grace.ts";
import { isScoutClientEvidenceLive } from "./access/policy.ts";
import {
  acceptedPostGameObservations,
  candidateIdentities,
  carriesClientTimeline,
  conflictingCandidates,
  localCanonicalMatchesAgree,
  parseLocalHistoryMatch,
  readSelectedCanonicalMatch,
  type SelectedCanonicalMatch,
} from "./canonical-match.ts";

/**
 * Selection of the history record (`local-history-1`) for a game no client
 * witnessed end. `parseLocalHistoryMatch` lives beside the other record
 * parsers in `canonical-match.ts`, which reads a frozen selection back.
 */
/**
 * History records this game's uploads support: one per `post_game`
 * observation that carries a history bundle alone (a game the client did not
 * witness end) and converts.
 *
 * Each waits the same deadline after its upload as an end-of-game record, so
 * a witnessed bundle or end-of-game block for the game, from this device or
 * another, can arrive first and take precedence.
 *
 * Copies of one device's history agree except where only the timeline can
 * decide a fact, so copies carrying a timeline are preferred.
 */
export async function readLocalHistoryCandidates(riotMatchId: RiotMatchId) {
  if (!(await isScoutClientEvidenceLive())) return [];
  const deadlineMs = scoutClientEndOfGameDeadlineSeconds() * 1000;
  const candidates = await acceptedPostGameObservations(riotMatchId);
  const parsed = await Promise.all(
    candidates.map(async (candidate) => {
      const match = parseLocalHistoryMatch(
        riotMatchId,
        candidate,
        await candidateIdentities(candidate),
      );
      if (match === null) return [];
      return [
        {
          candidate,
          match,
          eligibleAt: endOfGameEvidenceReadyAt(
            match.info,
            candidate.receivedAt,
            deadlineMs,
          ),
        },
      ];
    }),
  );
  // A device uploads a game's history once without its timeline and once
  // with it; the timeline can decide a "first" the row alone cannot, so the
  // better-informed copies are the candidates whenever there are any.
  const all = parsed.flat();
  const withTimeline = all.filter((entry) =>
    carriesClientTimeline(entry.candidate.payload),
  );
  return withTimeline.length > 0 ? withTimeline : all;
}

/**
 * Freeze a history record as the game's canonical match, in the same
 * selection row every other client record uses, so whichever froze first
 * stands. Every candidate must agree: two devices whose histories disagree
 * about the game produce no record.
 */
export async function selectLocalHistoryMatch(
  riotMatchId: RiotMatchId,
  candidates: Awaited<ReturnType<typeof readLocalHistoryCandidates>>,
  now = new Date(),
): Promise<SelectedCanonicalMatch> {
  const first = candidates.find((entry) => entry.eligibleAt <= now);
  if (first === undefined)
    throw new Error("Cannot select a history record before its deadline");
  if (
    candidates.some(
      ({ match }) => !localCanonicalMatchesAgree(first.match, match),
    )
  ) {
    conflictingCandidates(riotMatchId);
  }
  await prisma.scoutClientCanonicalMatch.upsert({
    where: { riotMatchId },
    create: {
      riotMatchId,
      sourceObservationId: first.candidate.observationId,
      payloadDigest: first.candidate.bodyDigest,
      selectedAt: now,
    },
    update: {},
  });
  const selected = await readSelectedCanonicalMatch(riotMatchId);
  if (selected === null) conflictingCandidates(riotMatchId);
  return selected;
}
