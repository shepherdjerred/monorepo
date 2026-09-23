import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import type { AuthenticatedScoutClient } from "#src/scout-client/authentication.ts";
import { resolveReplayProvenance } from "./evidence.ts";

/**
 * What the server wants done with a replay the client is holding.
 *
 * Asked before a byte is sent. The client cannot decide this for itself: only
 * the server knows whether it already has the file, whether anything can vouch
 * for the game, and whether this account is over quota. Answering here means a
 * refusal costs one small round trip instead of a multi-megabyte upload that
 * gets rejected three database reads in — the shape that was reaching the
 * client as `502 Bad Gateway`, because the proxy saw the upstream close under
 * a request body still in flight.
 */
export const ReplayOfferDecisionSchema = z.enum([
  /** Send it. */
  "want",
  /** Already stored; stop offering. */
  "have",
  /** Refused for good; never offer this file again. */
  "never",
  /** Nothing can vouch for the game yet, but something still might. */
  "later",
]);
export type ReplayOfferDecision = z.infer<typeof ReplayOfferDecisionSchema>;

export const ReplayOfferRequestSchema = z
  .object({
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.number().int().positive(),
    /** Platform the replay names, when the client could recover it. */
    platformId: z
      .string()
      .regex(/^[a-z]{2,4}\d{0,2}$/i)
      .nullish(),
  })
  .strict();
export type ReplayOfferRequest = z.infer<typeof ReplayOfferRequestSchema>;

export type ReplayOfferResult = {
  readonly decision: ReplayOfferDecision;
  /** Short, stable explanation. Shown in the client's diagnostics. */
  readonly reason: string;
};

/**
 * Decide an offer without touching the replay itself.
 *
 * Every refusal `uploadReplay` performs before reading the body is reproduced
 * here, so the PUT that follows a `want` has already cleared everything except
 * the checks that need the bytes.
 */
export async function decideReplayOffer(
  gameId: string,
  offer: ReplayOfferRequest,
  device: AuthenticatedScoutClient,
): Promise<ReplayOfferResult> {
  const existing = await prisma.scoutClientReplayArtifact.findUnique({
    where: { digest: offer.digest },
    select: { uploadState: true, gameId: true, lastError: true },
  });
  if (existing !== null && existing.gameId !== gameId) {
    return {
      decision: "never",
      reason: "This replay is already stored against a different game",
    };
  }
  if (existing?.uploadState === "COMPLETED") {
    return { decision: "have", reason: "Already stored" };
  }
  if (existing?.uploadState === "REJECTED") {
    return {
      decision: "never",
      reason: existing.lastError ?? "Replay was rejected",
    };
  }

  const provenance = await resolveReplayProvenance(
    { gameId, platformId: offer.platformId ?? null },
    device,
  );
  if (provenance === null) {
    // Deliberately not "never": Riot may yet archive the match, and another of
    // this owner's clients may yet report it. The client bounds its own
    // retries so a game nobody will ever vouch for stops costing anything.
    return {
      decision: "later",
      reason: "No match evidence yet from this account's clients or from Riot",
    };
  }
  return { decision: "want", reason: "Evidence is on file" };
}
