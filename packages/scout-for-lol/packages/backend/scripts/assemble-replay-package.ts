import { link, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { stdout } from "node:process";
import { parseArgs } from "node:util";
import { createStaticArchive } from "@shepherdjerred/root-scripts/lib/static-site-archive.ts";
import {
  prepareReplayPublication,
  readReplayPackageManifest,
} from "./replay-publication/package.ts";

async function removeScratch(directory: string, parent: string) {
  if (path.dirname(await realpath(directory)) !== parent)
    throw new Error("Replay assembly scratch directory escaped its root");
  await rm(directory, { recursive: true, force: true });
}

/** Package prebuilt files and preserve the producer's exact manifest bytes. */
export async function assembleReplayPackage(input: {
  source: string;
  archive: string;
}) {
  const source = await realpath(input.source);
  const output = path.resolve(input.archive);
  const parent = await realpath(path.dirname(output));
  const relative = path.relative(source, parent);
  if (
    relative === "" ||
    (!path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..")
  )
    throw new Error(
      "Replay archive output must be outside its source directory",
    );

  await readReplayPackageManifest(source);
  const archivePath = path.join(parent, path.basename(output));
  const scratch = await mkdtemp(path.join(parent, ".scout-replay-assembly-"));
  try {
    const draft = path.join(scratch, "package.tar");
    const { digest: archiveDigest } = await createStaticArchive(source, draft);
    const directory = path.join(scratch, "verify");
    await mkdir(directory);
    const { gameBuild, protocol, manifestSha256 } =
      await prepareReplayPublication({
        archivePath: draft,
        archiveDigest,
        directory,
      });
    // Install the verified archive without replacing an existing output.
    await link(draft, archivePath);
    return {
      outcome: "assembled",
      archivePath,
      archiveDigest,
      gameBuild,
      protocol,
      manifestSha256,
    } as const;
  } finally {
    await removeScratch(scratch, parent);
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { source: { type: "string" }, archive: { type: "string" } },
  });
  if (
    values.source === undefined ||
    values.source === "" ||
    values.archive === undefined ||
    values.archive === ""
  )
    throw new Error(
      "Supply --source=<renderer directory> and --archive=<output tar>",
    );
  stdout.write(
    `${JSON.stringify(await assembleReplayPackage({ source: values.source, archive: values.archive }), null, 2)}\n`,
  );
}
