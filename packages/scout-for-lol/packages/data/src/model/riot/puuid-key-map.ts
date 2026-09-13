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
 *   These keep old-domain values and cannot be recovered once the old key is
 *   retired, so they are a deliberate loss, never a default.
 */
export const PuuidKeyMapStatusSchema = z.enum([
  "pending",
  "harvested",
  "resolved",
  "unresolved",
]);

export type PuuidKeyMapStatus = z.infer<typeof PuuidKeyMapStatusSchema>;
