import { z } from "zod";

/**
 * Lifecycle of one identity in a Riot API-key domain migration.
 *
 * Riot encrypts PUUIDs per key holder, so crossing keys requires re-deriving
 * each identity through its key-independent Riot ID. These states track that
 * walk:
 *
 * - `pending` — discovered, no Riot ID yet.
 * - `harvested` — Riot ID known, not yet re-resolved under the new key.
 * - `resolved` — a new-domain PUUID exists; safe to rewrite.
 * - `unresolved` — Riot has no account for it (renamed, transferred, deleted).
 *   Still awaiting a decision: it may yet resolve on a retry, and while any row
 *   sits here the migration is incomplete.
 * - `stranded` — an unresolved identity an operator has accepted as lost. It
 *   keeps its old-domain value forever, because nothing can recover it once the
 *   old key is retired.
 *
 * The last two are the same fact with different standing, and keeping them
 * apart is what lets verification pass. A migration covering every participant
 * ever seen will always find some deleted accounts, so a gate that fails on any
 * unresolvable identity can never go green — but one that cannot tell "not
 * finished" from "knowingly given up" is not a gate at all.
 */
export const PuuidKeyMapStatusSchema = z.enum([
  "pending",
  "harvested",
  "resolved",
  "unresolved",
  "stranded",
]);

export type PuuidKeyMapStatus = z.infer<typeof PuuidKeyMapStatusSchema>;
