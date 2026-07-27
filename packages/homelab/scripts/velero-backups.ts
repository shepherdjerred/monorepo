import { z } from "zod";
import {
  parseVeleroArguments,
  readConfirmationLine,
  requiresClusterInventory,
} from "./migration-core.ts";

const bucket = "homelab";
const endpoint =
  "https://48948ed6cd40d73e34d27f0cc10e595f.r2.cloudflarestorage.com";
const backupPrefix = "torvalds/backups/";
const zfsPrefix = "zfspv-incr/";

async function run(command: readonly string[]): Promise<string> {
  const process = Bun.spawn([...command], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const output = await new Response(process.stdout).text();
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} exited ${exitCode.toString()}`);
  }
  return output;
}

const aws = (...commandArguments: readonly string[]): readonly string[] => [
  "aws",
  "s3",
  ...commandArguments,
  "--endpoint-url",
  endpoint,
  "--region",
  "auto",
];

async function listPrefix(prefix: string): Promise<string[]> {
  const output = await run(
    aws("ls", `s3://${bucket}/${prefix}`, "--recursive"),
  );
  return output.split("\n").filter((line) => line.length > 0);
}

async function clusterBackups(): Promise<string[]> {
  const output = await run(["velero", "backup", "get", "--output", "json"]);
  const response = z
    .object({
      items: z.array(z.object({ metadata: z.object({ name: z.string() }) })),
    })
    .parse(JSON.parse(output));
  return response.items.map((item) => item.metadata.name);
}

async function inventory(includeClusterBackups: boolean): Promise<{
  readonly backups: string[];
  readonly backupObjects: string[];
  readonly zfsObjects: string[];
}> {
  await run(aws("ls", `s3://${bucket}/`));
  const backupsPromise = includeClusterBackups
    ? clusterBackups()
    : Promise.resolve<string[]>([]);
  const [backups, backupObjects, zfsObjects] = await Promise.all([
    backupsPromise,
    listPrefix(backupPrefix),
    listPrefix(zfsPrefix),
  ]);
  return { backups, backupObjects, zfsObjects };
}

if (import.meta.main) {
  const options = parseVeleroArguments(Bun.argv.slice(2));
  const includeClusterBackups = requiresClusterInventory(options.command);
  const before = await inventory(includeClusterBackups);
  console.log(JSON.stringify(before, undefined, 2));
  if (options.command === "inspect") process.exit(0);
  if (!options.apply) {
    throw new Error("Destructive commands require --apply");
  }
  const phrase =
    options.command === "delete-all"
      ? "DELETE ALL BACKUPS"
      : "DELETE R2 BACKUPS";
  if (!options.yes) {
    if (!process.stdin.isTTY) {
      throw new Error("Non-interactive deletion requires --yes");
    }
    process.stdout.write(`Type '${phrase}' exactly to proceed: `);
    const confirmation = await readConfirmationLine(Bun.stdin.stream());
    if (confirmation !== phrase) throw new Error("Deletion cancelled");
  }
  if (options.command === "delete-all") {
    for (const name of before.backups) {
      await run(["velero", "backup", "delete", name, "--confirm"]);
    }
  }
  if (
    options.command === "delete-all" ||
    options.target === "backups" ||
    options.target === "all"
  ) {
    await run(aws("rm", `s3://${bucket}/${backupPrefix}`, "--recursive"));
  }
  if (
    options.command === "delete-all" ||
    options.target === "zfs" ||
    options.target === "all"
  ) {
    await run(aws("rm", `s3://${bucket}/${zfsPrefix}`, "--recursive"));
  }
  const after = await inventory(includeClusterBackups);
  if (
    ((options.command === "delete-all" ||
      options.target === "backups" ||
      options.target === "all") &&
      after.backupObjects.length > 0) ||
    ((options.command === "delete-all" ||
      options.target === "zfs" ||
      options.target === "all") &&
      after.zfsObjects.length > 0) ||
    (options.command === "delete-all" && after.backups.length > 0)
  ) {
    throw new Error(`Deletion postcondition failed: ${JSON.stringify(after)}`);
  }
  console.log("Velero backup deletion verified");
}
