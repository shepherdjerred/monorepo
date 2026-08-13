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
};

export function parseR2OrphanArguments(args: readonly string[]): Options {
  const command = args[0];
  if (command !== "inspect" && command !== "apply") {
    throw new Error(
      "Usage: bun run r2:orphans -- inspect|apply --manifest <path> [--apply] [--yes]",
    );
  }
  let manifestPath: string | undefined;
  let apply = false;
  let yes = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--manifest":
        manifestPath = args[index + 1];
        if (manifestPath === undefined || manifestPath === "") {
          throw new Error("--manifest requires a path");
        }
        index += 1;
        break;
      case "--apply":
        apply = true;
        break;
      case "--yes":
        yes = true;
        break;
      case undefined:
        throw new Error("Missing argument");
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (manifestPath === undefined) {
    throw new Error("--manifest is required");
  }
  if (command === "inspect" && (apply || yes)) {
    throw new Error("inspect does not accept destructive flags");
  }
  return { command, manifestPath, apply, yes };
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

async function observe(observedAt: string): Promise<{
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

async function inspect(manifestPath: string): Promise<void> {
  const { manifest } = await observe(new Date().toISOString());
  await Bun.write(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`);
  console.log(
    `Wrote ${manifest.candidates.length.toString()} guarded R2 orphan candidates to ${manifestPath}`,
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
  const current = await observe(approved.observedAt);
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
    const latest = await observe(approved.observedAt);
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
  if (options.command === "inspect") await inspect(options.manifestPath);
  else await applyCleanup(options);
}
