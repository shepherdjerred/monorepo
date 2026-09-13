/**
 * Migrate every stored PUUID from one Riot API key's encryption domain to
 * another.
 *
 * Riot encrypts identifiers per API-key holder: "All encrypted values are
 * unique per API Key holder... the values for account ID, PUUID and id would
 * be different for each key holder, for a given player." Switching Scout from
 * the personal-tier key to the production key therefore invalidates every
 * PUUID we have ever stored. Refreshing a key in place does NOT change them;
 * only crossing between keys does.
 *
 * The bridge is the Riot ID (gameName#tagLine), which is key-independent:
 *
 *     old PUUID --(old key)--> Riot ID --(new key)--> new PUUID
 *
 * The first hop is a one-way door. Once the old key is retired, an old PUUID
 * is undecryptable and Riot cannot tell us who it belonged to. So harvest runs
 * to completion, and is verified complete, before anything is rewritten.
 *
 * Phases are independent and resumable; each is safe to re-run.
 *
 *   collect  discover every PUUID-bearing column, then every distinct PUUID
 *   harvest  old PUUID -> Riot ID, using the OLD key
 *   resolve  Riot ID -> new PUUID, using the NEW key
 *   apply    rewrite every stored reference (requires --apply)
 *   strand   accept unresolvable identities as permanently lost
 *   verify   assert no old-domain PUUID survives
 *
 * Targets both live shapes: prod's SQLite and beta's Postgres, selected from
 * DATABASE_URL. The column inventory is discovered at run time because their
 * schemas differ and prod's will change again at promotion.
 *
 * The map table outlives the migration. Raw S3 payloads keep old-domain
 * PUUIDs forever, so any future re-derivation from the corpus needs it.
 *
 * Usage:
 *   OLD_RIOT_API_KEY=... NEW_RIOT_API_KEY=... DATABASE_URL=... \
 *     bun scripts/migrate-puuid-key.ts <phase> [--apply] [--allow-unresolved]
 */

import { openDb } from "./puuid-migration/db.ts";
import { assertTrackedSourcesMatchSchema } from "./puuid-migration/discovery.ts";
import { ensureMapTable } from "./puuid-migration/map-table.ts";
import { apply, collect, harvest, resolve } from "./puuid-migration/phases.ts";
import { strand, verify } from "./puuid-migration/verify.ts";

const phase = Bun.argv[2];
const confirmed = Bun.argv.includes("--apply");
const allowUnresolved = Bun.argv.includes("--allow-unresolved");
const acceptStranded = Bun.argv.includes("--accept-stranded");

const db = await openDb();
console.log(`target: ${db.kind}\n`);
await ensureMapTable(db);
// Every phase reads the declared sources, and a wrong column name is not a SQL
// error on SQLite — it becomes a string literal. Check the declaration against
// the live catalog once, before any phase acts on it.
await assertTrackedSourcesMatchSchema(db);

try {
  switch (phase) {
    case "collect":
      await collect(db);
      break;
    case "harvest":
      await harvest(db);
      break;
    case "resolve":
      await resolve(db);
      break;
    case "apply":
      if (!confirmed) {
        throw new Error(
          "apply rewrites production data; pass --apply to confirm",
        );
      }
      await apply(db, allowUnresolved);
      break;
    case "strand":
      await strand(db, acceptStranded);
      break;
    case "verify":
      await verify(db);
      break;
    case undefined:
    default:
      throw new Error(
        "usage: migrate-puuid-key.ts <collect|harvest|resolve|apply|strand|verify> " +
          "[--apply] [--allow-unresolved] [--accept-stranded]",
      );
  }
} finally {
  await db.close();
}
