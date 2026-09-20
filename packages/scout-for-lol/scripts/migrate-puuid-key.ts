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
 *   begin   open a later key transition without discarding remap history
 *   collect  discover every PUUID-bearing column, then every distinct PUUID
 *   seed     add identities from a corpus inventory file
 *   harvest  old PUUID -> Riot ID, using the OLD key
 *   resolve  Riot ID -> new PUUID, using the NEW key
 *   apply    rewrite every stored reference (requires --apply)
 *   strand   accept unresolvable identities as permanently lost
 *   verify   assert no old-domain PUUID survives
 *   export   write this database's map to a file
 *   import   load a map built elsewhere into this database
 *
 * Live beta and prod are Postgres, selected through DATABASE_URL. The local
 * harvest database is SQLite so the days-long Riot phase does not depend on a
 * cluster tunnel. The column inventory is discovered at run time because the
 * live schemas can differ during a rollout.
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
import {
  exportMap,
  importMap,
  mapSize,
  parseMapRows,
  seedIdentities,
  serializeMap,
} from "./puuid-migration/transfer.ts";
import { parseInventory } from "./puuid-corpus/inventory.ts";
import { apply, collect, harvest, resolve } from "./puuid-migration/phases.ts";
import { beginTransition } from "./puuid-migration/cutover.ts";
import { strand, verify } from "./puuid-migration/verify.ts";
import { waitOutColdStart } from "./puuid-migration/riot.ts";

function flagValue(name: string): string {
  const at = Bun.argv.indexOf(name);
  const value = at === -1 ? undefined : Bun.argv[at + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

const phase = Bun.argv[2];
const confirmed = Bun.argv.includes("--apply");
const allowUnresolved = Bun.argv.includes("--allow-unresolved");
const acceptStranded = Bun.argv.includes("--accept-stranded");
const newTransition = Bun.argv.includes("--new-transition");

const db = await openDb();
console.log(`target: ${db.kind}\n`);
await ensureMapTable(db);
// Every phase reads the declared sources, and a wrong column name is not a SQL
// error on SQLite — it becomes a string literal. Check the declaration against
// the live catalog once, before any phase acts on it.
await assertTrackedSourcesMatchSchema(db);

try {
  switch (phase) {
    case "begin":
      await beginTransition(db, newTransition);
      break;
    case "collect":
      await collect(db);
      break;
    case "harvest":
      await harvest(db);
      break;
    case "resolve":
      // Defaults to waiting, because this is the phase a supervisor restarts.
      // A previous run's share of the window is unknowable, so the safe
      // behaviour has to be what happens when nobody passes a flag.
      if (!Bun.argv.includes("--no-wait-window")) {
        await waitOutColdStart();
      }
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
    case "seed": {
      const rows = parseInventory(await Bun.file(flagValue("--from")).text());
      const result = await seedIdentities(
        db,
        rows.map((row) => row.oldPuuid),
      );
      const seededTotal = await mapSize(db);
      console.log(
        `seed: ${result.added.toString()} identities added, ` +
          `${result.alreadyKnown.toString()} already known; map now holds ${seededTotal.toString()}`,
      );
      break;
    }
    case "export": {
      const rows = await exportMap(db);
      const out = flagValue("--out");
      await Bun.write(out, serializeMap(rows));
      console.log(
        `export: ${rows.length.toString()} mappings written to ${out}`,
      );
      break;
    }
    case "import": {
      const rows = parseMapRows(await Bun.file(flagValue("--from")).text());
      const result = await importMap(db, rows);
      const importedTotal = await mapSize(db);
      console.log(
        `import: ${result.inserted.toString()} inserted, ${result.updated.toString()} updated; ` +
          `map now holds ${importedTotal.toString()}`,
      );
      break;
    }
    case "strand":
      await strand(db, acceptStranded);
      break;
    case "verify":
      await verify(db);
      break;
    case undefined:
    default:
      throw new Error(
        "usage: migrate-puuid-key.ts " +
          "<begin|collect|seed|harvest|resolve|apply|strand|verify|export|import> " +
          "[--apply] [--allow-unresolved] [--accept-stranded] [--new-transition] [--no-wait-window] " +
          "[--from FILE] [--out FILE]",
      );
  }
} finally {
  await db.close();
}
