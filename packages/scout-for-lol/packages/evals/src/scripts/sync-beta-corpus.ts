import { Database } from "bun:sqlite";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { argumentValue } from "#lib/cli.ts";
import {
  BetaProfileRowSchema,
  defaultBetaCorpusPath,
  writeBetaCorpusSnapshot,
} from "#materialization/beta-corpus.ts";

const PodListSchema = z.object({
  items: z.array(
    z.object({
      metadata: z.object({ name: z.string(), uid: z.string() }),
      status: z.object({
        conditions: z.array(z.object({ status: z.string(), type: z.string() })),
        phase: z.string(),
      }),
    }),
  ),
});

const REMOTE_QUERY = `
  import { Database } from "bun:sqlite";
  const database = new Database("/data/db.sqlite", { readonly: true, strict: true });
  const rows = database.query(\`
    SELECT
      a.id AS accountId,
      p.id AS playerId,
      p.alias,
      p.discordId,
      p.serverId,
      a.puuid,
      a.region
    FROM Account a
    JOIN Player p ON p.id = a.playerId
    ORDER BY p.alias, a.id
  \`).all();
  await Bun.write(Bun.stdout, JSON.stringify(rows));
  database.close();
`;

async function run(command: string[]): Promise<string> {
  const executable = command[0];
  if (executable === undefined) throw new Error("Cannot run an empty command");
  const process = Bun.spawn(command, { stderr: "pipe", stdout: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${executable} exited with ${String(exitCode)}: ${stderr}`);
  }
  return stdout;
}

async function betaPod(): Promise<{ name: string; uid: string }> {
  const output = await run([
    "kubectl",
    "get",
    "pods",
    "-n",
    "scout-beta",
    "-o",
    "json",
  ]);
  const pods = PodListSchema.parse(JSON.parse(output)).items.filter(
    (pod) =>
      pod.metadata.name.startsWith("scout-beta-scout-backend-") &&
      pod.status.phase === "Running" &&
      pod.status.conditions.some(
        (condition) =>
          condition.type === "Ready" && condition.status === "True",
      ),
  );
  if (pods.length !== 1) {
    throw new Error(
      `Expected one ready Scout beta pod, found ${String(pods.length)}`,
    );
  }
  const pod = pods[0];
  if (pod === undefined) throw new Error("Scout beta pod selection failed");
  return pod.metadata;
}

const destination = argumentValue("--output") ?? defaultBetaCorpusPath();
const pod = await betaPod();
const output = await run([
  "kubectl",
  "exec",
  "-n",
  "scout-beta",
  pod.name,
  "--",
  "bun",
  "-e",
  REMOTE_QUERY,
]);
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
