import { z } from "zod";
import {
  assertManifestRevalidated,
  buildR2OrphanManifest,
  metadataBackupNames,
  R2_BACKUP_METADATA_BACKUPS_PREFIX,
  R2OrphanManifestSchema,
  R2_ZFS_PREFIX,
  type R2OrphanManifest,
} from "./r2-orphan-cleanup-core.ts";
import { listR2Objects, r2Configuration } from "./r2-prefix-inventory.ts";

const KubectlBackupListSchema = z.object({
  items: z.array(z.object({ metadata: z.object({ name: z.string().min(1) }) })),
});

type Options = {
  command: "inspect" | "apply";
  manifestPath: string;
  apply: boolean;
  yes: boolean;
  heldBackupNames: string[];
  onlyBackupName: string | undefined;
};

type ParseState = Omit<Options, "command" | "manifestPath"> & {
  manifestPath: string | undefined;
};

function requiredArgument(
  args: readonly string[],
  index: number,
  flag: string,
): string {
  const value = args[index + 1];
  if (value === undefined || value === "") {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgument(
  args: readonly string[],
  index: number,
  state: ParseState,
): number {
  const argument = args[index];
  if (argument === "--manifest") {
    state.manifestPath = requiredArgument(args, index, argument);
    return index + 2;
  }
  if (argument === "--apply") {
    state.apply = true;
    return index + 1;
  }
  if (argument === "--yes") {
    state.yes = true;
    return index + 1;
  }
  if (argument === "--hold-backup") {
    const name = requiredArgument(args, index, argument);
    if (state.heldBackupNames.includes(name)) {
      throw new Error(`--hold-backup was repeated for ${name}`);
    }
    state.heldBackupNames.push(name);
    return index + 2;
  }
  if (argument === "--only-backup") {
    if (state.onlyBackupName !== undefined) {
      throw new Error("--only-backup may only be provided once");
    }
    state.onlyBackupName = requiredArgument(args, index, argument);
    return index + 2;
  }
  if (argument === undefined) {
    throw new Error("Missing argument");
  }
  throw new Error(`Unknown argument: ${argument}`);
}

export function parseR2OrphanArguments(args: readonly string[]): Options {
  const command = args[0];
  if (command !== "inspect" && command !== "apply") {
    throw new Error(
      "Usage: bun run r2:orphans -- inspect|apply --manifest <path> [--hold-backup <name>]... [--only-backup <name>] [--apply] [--yes]",
    );
  }
  const state: ParseState = {
    manifestPath: undefined,
    apply: false,
    yes: false,
    heldBackupNames: [],
    onlyBackupName: undefined,
  };
  for (let index = 1; index < args.length; ) {
    index = parseArgument(args, index, state);
  }
  if (state.manifestPath === undefined) {
    throw new Error("--manifest is required");
  }
  if (command === "inspect" && (state.apply || state.yes)) {
    throw new Error("inspect does not accept destructive flags");
  }
  return {
    command,
    manifestPath: state.manifestPath,
    apply: state.apply,
    yes: state.yes,
    heldBackupNames: state.heldBackupNames.toSorted(),
    onlyBackupName: state.onlyBackupName,
  };
}

async function run(
  command: readonly string[],
  env?: Record<string, string>,
): Promise<string> {
  const child = Bun.spawn([...command], {
    env: env === undefined ? Bun.env : { ...Bun.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command[0] ?? "command"} exited ${exitCode.toString()}: ${stderr.trim()}`,
    );
  }
  return stdout;
}

async function liveBackupNames(): Promise<string[]> {
  const output = await run([
    "kubectl",
    "get",
    "backups.velero.io",
    "--namespace",
    "velero",
    "--output",
    "json",
  ]);
  return KubectlBackupListSchema.parse(JSON.parse(output))
    .items.map((item) => item.metadata.name)
    .toSorted();
}

async function observe(
  observedAt: string,
  heldBackupNames: readonly string[],
  onlyBackupName: string | undefined,
): Promise<{
  manifest: R2OrphanManifest;
  zfsObjects: Awaited<ReturnType<typeof listR2Objects>>;
}> {
  const config = r2Configuration();
  const [liveNames, metadataObjects, zfsObjects] = await Promise.all([
    liveBackupNames(),
    listR2Objects(R2_BACKUP_METADATA_BACKUPS_PREFIX),
    listR2Objects(R2_ZFS_PREFIX),
  ]);
  return {
    manifest: buildR2OrphanManifest({
      observedAt,
      storage: {
        bucket: config.bucket,
        endpointHost: new URL(config.endpoint).host,
      },
      zfsObjects,
      liveBackupNames: liveNames,
      metadataBackupNames: metadataBackupNames(metadataObjects),
      heldBackupNames,
      onlyBackupName,
    }),
    zfsObjects,
  };
}

async function readConfirmation(): Promise<string> {
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let value = "";
  try {
    let result = await reader.read();
    while (!result.done) {
      value += decoder.decode(result.value, { stream: true });
      const newline = value.indexOf("\n");
      if (newline !== -1) return value.slice(0, newline).replace(/\r$/, "");
      result = await reader.read();
    }
    return `${value}${decoder.decode()}`.replace(/\r$/, "");
  } finally {
    reader.releaseLock();
  }
}

async function removePrefix(prefix: string): Promise<void> {
  const config = r2Configuration();
  await run(
    [
      "aws",
      "s3",
      "rm",
      `s3://${config.bucket}/${prefix}`,
      "--recursive",
      "--only-show-errors",
      "--endpoint-url",
      config.endpoint,
      "--region",
      "auto",
    ],
    {
      AWS_ACCESS_KEY_ID: config.accessKeyId,
      AWS_SECRET_ACCESS_KEY: config.secretAccessKey,
    },
  );
}

async function inspect(options: Options): Promise<void> {
  const { manifest } = await observe(
    new Date().toISOString(),
    options.heldBackupNames,
    options.onlyBackupName,
  );
  await Bun.write(
    options.manifestPath,
    `${JSON.stringify(manifest, undefined, 2)}\n`,
  );
  console.log(
    `Wrote ${manifest.candidates.length.toString()} guarded R2 orphan candidates to ${options.manifestPath}`,
  );
  console.log(JSON.stringify(manifest, undefined, 2));
}

async function applyCleanup(options: Options): Promise<void> {
  if (!options.apply) {
    throw new Error("apply requires the explicit --apply flag");
  }
  const approved = R2OrphanManifestSchema.parse(
    JSON.parse(await Bun.file(options.manifestPath).text()),
  );
  if (
    JSON.stringify(options.heldBackupNames) !==
    JSON.stringify(approved.heldBackupNames)
  ) {
    throw new Error(
      "Apply hold list does not match the reviewed manifest; pass every --hold-backup name used during inspect",
    );
  }
  if (options.onlyBackupName !== (approved.onlyBackupName ?? undefined)) {
    throw new Error(
      "Apply backup selector does not match the reviewed manifest; pass the same --only-backup value used during inspect",
    );
  }
  const current = await observe(
    approved.observedAt,
    approved.heldBackupNames,
    approved.onlyBackupName ?? undefined,
  );
  assertManifestRevalidated(approved, current.manifest);
  if (!options.yes) {
    if (!process.stdin.isTTY) {
      throw new Error("Non-interactive cleanup requires --yes");
    }
    const phrase = `DELETE ${approved.candidates.length.toString()} R2 ORPHAN PREFIXES`;
    process.stdout.write(`Type '${phrase}' exactly to proceed: `);
    if ((await readConfirmation()) !== phrase) {
      throw new Error("R2 orphan cleanup cancelled");
    }
  }

  let expected = approved;
  for (const candidate of approved.candidates) {
    const latest = await observe(
      approved.observedAt,
      approved.heldBackupNames,
      approved.onlyBackupName ?? undefined,
    );
    assertManifestRevalidated(expected, latest.manifest);
    if (latest.manifest.protectedBackupNames.includes(candidate.backupName)) {
      throw new Error(
        `Backup ${candidate.backupName} became protected during cleanup`,
      );
    }
    await removePrefix(candidate.prefix);
    expected = {
      ...expected,
      candidates: expected.candidates.filter(
        (remaining) => remaining.prefix !== candidate.prefix,
      ),
    };
  }

  const remaining = await listR2Objects(R2_ZFS_PREFIX);
  const deletedPrefixes = current.manifest.candidates.map(
    (candidate) => candidate.prefix,
  );
  const undeleted = remaining.filter((object) =>
    deletedPrefixes.some((prefix) => object.key.startsWith(prefix)),
  );
  if (undeleted.length > 0) {
    throw new Error(
      `R2 orphan cleanup postcondition failed for ${undeleted.length.toString()} objects`,
    );
  }
  console.log(
    `Deleted and verified ${deletedPrefixes.length.toString()} R2 orphan prefixes`,
  );
}

if (import.meta.main) {
  const options = parseR2OrphanArguments(Bun.argv.slice(2));
  if (options.command === "inspect") await inspect(options);
  else await applyCleanup(options);
}
