import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { ConfirmationIntentPayloadSchema } from "@scout-for-lol/data";
import {
  devPostgresPort,
  ensureDevPostgres,
  psqlMaintenance,
} from "#src/testing/postgres-server.ts";

/**
 * The confirmation-intent migration moves live rows, so it is verified against
 * a real Postgres rather than reasoned about.
 *
 * What matters is not that the table exists afterwards but that nothing in a
 * pending confirmation changed meaning: an id a browser tab or a Discord
 * button still holds, a `consumedAt`/`resultJson` pair that stops an already
 * spent intent from being spent again, and a payload the new discriminated
 * union can actually parse.
 */

const MIGRATION = "20260904000000_confirmation_intent";
const MIGRATIONS_DIR = `${import.meta.dir}/../../../prisma/migrations`;

const SERVER_A = "100000000000000001";
const SERVER_B = "100000000000000002";
const ACTOR = "200000000000000001";
const FUND_INTENT = "11111111-1111-4111-8111-111111111111";
const CONTRIBUTE_INTENT = "22222222-2222-4222-8222-222222222222";
const CANCEL_INTENT = "33333333-3333-4333-8333-333333333333";
const CONSUMED_AT = "2026-09-01 12:00:00";
const CONSUMED_RESULT = '{"kind":"contributed","potTotal":25}';

const MigratedRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  serverId: z.string(),
  actorDiscordId: z.string(),
  payload: z.string(),
  idempotencyKey: z.string(),
  consumedAt: z.string().nullable(),
  resultJson: z.string().nullable(),
  dareId: z.number().int(),
  expectedRevision: z.number().int(),
});
type MigratedRow = z.infer<typeof MigratedRowSchema>;

let databaseName = "";

function psql(sql: string): string {
  const result = Bun.spawnSync(
    [
      "psql",
      "-h",
      "127.0.0.1",
      "-p",
      devPostgresPort().toString(),
      "-U",
      "scout",
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-c",
      sql,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    throw new Error(`psql failed (${sql}): ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

function applyMigration(name: string): void {
  const result = Bun.spawnSync(
    [
      "psql",
      "-h",
      "127.0.0.1",
      "-p",
      devPostgresPort().toString(),
      "-U",
      "scout",
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      `${MIGRATIONS_DIR}/${name}/migration.sql`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `applying ${name} failed: ${result.stderr.toString()}${result.stdout.toString()}`,
    );
  }
}

/** Every migration directory, in the order Prisma applies them. */
function migrationNames(): string[] {
  const glob = new Bun.Glob("*/migration.sql");
  return [...glob.scanSync({ cwd: MIGRATIONS_DIR })]
    .map((file) => file.slice(0, file.indexOf("/")))
    .sort();
}

/** The dares and old-shape intents that stand in for live production rows. */
function seedPreMigrationRows(): void {
  psql(`
    INSERT INTO "BucksDareV2"
      (id, "serverId", "channelId", "challengerDiscordId", "openingStake", "updatedAt")
    VALUES
      (1, '${SERVER_A}', '300000000000000001', '${ACTOR}', 20, NOW()),
      (2, '${SERVER_B}', '300000000000000002', '${ACTOR}', 30, NOW());

    INSERT INTO "BucksDareV2ConfirmationIntent"
      (id, "dareId", revision, "actorDiscordId", action, "actionPayload",
       "idempotencyKey", "expiresAt", "consumedAt", "resultJson")
    VALUES
      ('${FUND_INTENT}', 1, 1, '${ACTOR}', 'fund', '{"action":"fund"}',
       'key-fund', NOW() + INTERVAL '10 minutes', NULL, NULL),
      ('${CONTRIBUTE_INTENT}', 1, 2, '${ACTOR}', 'contribute',
       '{"action":"contribute","amount":5}',
       'key-contribute', NOW() + INTERVAL '10 minutes',
       TIMESTAMP '${CONSUMED_AT}', '${CONSUMED_RESULT}'),
      ('${CANCEL_INTENT}', 2, 1, '${ACTOR}', 'cancel', '{"action":"cancel"}',
       'key-cancel', NOW() + INTERVAL '10 minutes', NULL, NULL);
  `);
}

function migratedRows(): Map<string, MigratedRow> {
  const raw = psql(`
    SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.id), '[]')
      FROM (
        SELECT id, kind, "serverId", "actorDiscordId", payload, "idempotencyKey",
               to_char("consumedAt", 'YYYY-MM-DD HH24:MI:SS') AS "consumedAt",
               "resultJson", "dareId", "expectedRevision"
          FROM "ConfirmationIntent"
      ) t;
  `);
  const parsed: unknown = JSON.parse(raw);
  const rows = MigratedRowSchema.array().parse(parsed);
  return new Map(rows.map((row) => [row.id, row]));
}

let rows: Map<string, MigratedRow>;

beforeAll(() => {
  ensureDevPostgres();
  databaseName = `scout_test_${Date.now().toString()}_intent_migration`;
  psqlMaintenance(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  psqlMaintenance(`CREATE DATABASE "${databaseName}"`);
  const names = migrationNames();
  const target = names.indexOf(MIGRATION);
  if (target === -1) {
    throw new Error(`${MIGRATION} is missing from ${MIGRATIONS_DIR}`);
  }
  for (const name of names.slice(0, target)) {
    applyMigration(name);
  }
  seedPreMigrationRows();
  applyMigration(MIGRATION);
  rows = migratedRows();
}, 180_000);

afterAll(() => {
  if (databaseName !== "") {
    psqlMaintenance(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  }
});

describe("the confirmation intent migration", () => {
  test("carries every intent across under its stable id", () => {
    expect([...rows.keys()].toSorted()).toEqual(
      [FUND_INTENT, CONTRIBUTE_INTENT, CANCEL_INTENT].toSorted(),
    );
  });

  test("prefixes the folded action column into the kind discriminator", () => {
    expect(rows.get(FUND_INTENT)?.kind).toBe("dare_fund");
    expect(rows.get(CONTRIBUTE_INTENT)?.kind).toBe("dare_contribute");
    expect(rows.get(CANCEL_INTENT)?.kind).toBe("dare_cancel");
  });

  test("denormalizes each intent's guild from the dare it targets", () => {
    expect(rows.get(FUND_INTENT)?.serverId).toBe(SERVER_A);
    expect(rows.get(CONTRIBUTE_INTENT)?.serverId).toBe(SERVER_A);
    expect(rows.get(CANCEL_INTENT)?.serverId).toBe(SERVER_B);
  });

  test("keeps the dare target and the revision the actor saw", () => {
    expect(rows.get(FUND_INTENT)).toMatchObject({
      dareId: 1,
      expectedRevision: 1,
      actorDiscordId: ACTOR,
      idempotencyKey: "key-fund",
    });
    expect(rows.get(CONTRIBUTE_INTENT)).toMatchObject({
      dareId: 1,
      expectedRevision: 2,
    });
    expect(rows.get(CANCEL_INTENT)).toMatchObject({
      dareId: 2,
      expectedRevision: 1,
    });
  });

  /**
   * The double-spend line. An intent that has already been confirmed must stay
   * confirmed, or its `dare_fund`/`dare_contribute` action runs a second time
   * against a real balance.
   */
  test("preserves the consumed marker and the recorded outcome", () => {
    expect(rows.get(CONTRIBUTE_INTENT)?.consumedAt).toBe(CONSUMED_AT);
    expect(rows.get(CONTRIBUTE_INTENT)?.resultJson).toBe(CONSUMED_RESULT);
    expect(rows.get(FUND_INTENT)?.consumedAt).toBeNull();
    expect(rows.get(FUND_INTENT)?.resultJson).toBeNull();
    expect(rows.get(CANCEL_INTENT)?.consumedAt).toBeNull();
  });

  test("rewrites every payload into the new discriminated union", () => {
    for (const row of rows.values()) {
      const payload = ConfirmationIntentPayloadSchema.parse(
        JSON.parse(row.payload),
      );
      expect(payload.kind).toBe(row.kind);
      // Minting with an existing idempotency key compares the stored payload
      // against a freshly serialized one, so the migrated text has to match
      // byte for byte, not merely parse.
      expect(row.payload).toBe(JSON.stringify(payload));
    }
  });

  test("keeps a contribution's amount", () => {
    const payload = ConfirmationIntentPayloadSchema.parse(
      JSON.parse(rows.get(CONTRIBUTE_INTENT)?.payload ?? "null"),
    );
    expect(payload).toEqual({ kind: "dare_contribute", amount: 5 });
  });

  test("leaves no dare-only intent table behind", () => {
    expect(psql(`SELECT to_regclass('"BucksDareV2ConfirmationIntent"')`)).toBe(
      "",
    );
  });
});
