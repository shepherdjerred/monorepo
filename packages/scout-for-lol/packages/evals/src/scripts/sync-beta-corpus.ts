import { Database } from "bun:sqlite";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  execInPod,
  findReadyMasterPod,
} from "@shepherdjerred/toolkit/lib/postgres/pod.ts";

import { argumentValue } from "#lib/cli.ts";
import {
  BetaProfileRowSchema,
  defaultBetaCorpusPath,
  writeBetaCorpusSnapshot,
} from "#materialization/beta-corpus.ts";

const BETA_CLUSTER = {
  namespace: "scout-beta",
  cluster: "scout-beta-postgresql",
  container: "postgres",
} as const;

// Runs inside the scout-beta Postgres pod via the local trust socket
// (pgHba "local all all trust" exists for exactly these exec runbooks).
// Mixed-case identifiers must be quoted under Postgres.
const REMOTE_QUERY = `
  SELECT COALESCE(json_agg(t), '[]') FROM (
    SELECT
      a.id AS "accountId",
      p.id AS "playerId",
      p.alias,
      p."discordId",
      p."serverId",
      a.puuid,
      a.region
    FROM "Account" a
    JOIN "Player" p ON p.id = a."playerId"
    ORDER BY p.alias, a.id
  ) t
`;

const destination = argumentValue("--output") ?? defaultBetaCorpusPath();
const pod = await findReadyMasterPod(BETA_CLUSTER);
const output = await execInPod({
  namespace: BETA_CLUSTER.namespace,
  pod: pod.name,
  container: BETA_CLUSTER.container,
  command: [
    "psql",
    "-U",
    "postgres",
    "-d",
    "scout",
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    REMOTE_QUERY,
  ],
});
const parsed: unknown = JSON.parse(output);
const profiles = z.array(BetaProfileRowSchema).min(1).parse(parsed);
await mkdir(path.dirname(destination), { recursive: true });
const temporaryPath = `${destination}.${crypto.randomUUID()}.tmp`;
try {
  writeBetaCorpusSnapshot(temporaryPath, profiles, `${pod.name}:${pod.uid}`);
  const check = new Database(temporaryPath, { readonly: true, strict: true });
  try {
    const count = z
      .strictObject({ count: z.number().int().positive() })
      .parse(check.query("SELECT COUNT(*) AS count FROM profiles").get()).count;
    if (count !== profiles.length) {
      throw new Error(
        `Snapshot contains ${String(count)} of ${String(profiles.length)} profiles`,
      );
    }
  } finally {
    check.close();
  }
  await rename(temporaryPath, destination);
} catch (error) {
  await rm(temporaryPath, { force: true });
  throw error;
}
await Bun.write(
  Bun.stdout,
  `${JSON.stringify({ destination, profileCount: profiles.length, sourcePod: pod.name }, null, 2)}\n`,
);
