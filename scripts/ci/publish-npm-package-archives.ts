#!/usr/bin/env bun
/**
 * Freeze every npm channel package's tarball in `delivery-artifacts`.
 *
 * Runs on every default-branch build under the v2 catalog: Delivery decides
 * by digest whether the tarball is new, so CI never guesses from changed
 * paths. Nothing here publishes to npm; the channel deployment does (X12).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { ArtifactInputSchema } from "@shepherdjerred/delivery/contract";
import { publishImmutableArchive } from "../lib/artifacts/immutable-archive.ts";
import {
  NPM_CHANNEL_PACKAGES,
  NPM_PACKAGE_HANDOFF,
  npmPackageArchiveUri,
  npmPackageArtifactId,
  npmPackageDigest,
  npmPackageTarball,
  parseNpmPackagePublications,
  registryTarballReader,
} from "../lib/artifacts/npm-package-archive.ts";
import { writeJsonHandoff } from "../lib/ci/ci-handoff.ts";
import { requireEnv, run } from "../lib/run.ts";

const repoRoot = path.resolve(import.meta.dir, "../..");
const ManifestSchema = z.object({ name: z.string(), version: z.string() });

/** Build, then `bun pm pack`, whose timestamps and owners are fixed. */
async function pack(directory: string, scratch: string) {
  const cwd = path.join(repoRoot, directory);
  await run(["bun", "--no-install", "run", "build"], { cwd });
  const destination = path.join(scratch, "pack");
  await run(["bun", "pm", "pack", "--destination", destination, "--quiet"], {
    cwd,
  });
  const [file, ...others] = await Array.fromAsync(
    new Bun.Glob("*.tgz").scan({ cwd: destination }),
  );
  if (file === undefined || others.length > 0)
    throw new Error(
      `bun pm pack did not write exactly one tarball for ${directory}`,
    );
  const manifest = ManifestSchema.parse(
    await Bun.file(path.join(cwd, "package.json")).json(),
  );
  return {
    bytes: new Uint8Array(
      await Bun.file(path.join(destination, file)).arrayBuffer(),
    ),
    ...manifest,
  };
}

async function main() {
  const execution = {
    repositoryId: Number(requireEnv("CI_REPO_ID")),
    pipelineNumber: Number(requireEnv("CI_PIPELINE_NUMBER")),
  };
  const publications = [];
  for (const pkg of NPM_CHANNEL_PACKAGES) {
    const scratch = await mkdtemp(path.join(tmpdir(), "npm-package-archive-"));
    try {
      const tarball = await npmPackageTarball(pkg, {
        pack: async (directory) => await pack(directory, scratch),
        published: registryTarballReader(),
      });
      const digest = npmPackageDigest(tarball.bytes);
      const file = path.join(scratch, "package.tgz");
      await Bun.write(file, tarball.bytes);
      const uri = npmPackageArchiveUri(pkg, digest);
      await publishImmutableArchive({
        uri,
        digest,
        file,
        readback: path.join(scratch, "readback.tgz"),
      });
      publications.push({
        serviceId: pkg.serviceId,
        artifact: ArtifactInputSchema.parse({
          id: npmPackageArtifactId(execution, pkg),
          component: pkg.component,
          kind: "archive",
          uri,
          digest,
          runtimeDigests: [],
          requires: {},
          version: tarball.version,
        }),
      });
      console.log(
        `Froze ${pkg.name}@${tarball.version} (${tarball.published ? "as npm serves it" : "unpublished; the channel publishes it"}) at ${uri}`,
      );
    } finally {
      await rm(scratch, { recursive: true });
    }
  }
  await writeJsonHandoff(
    NPM_PACKAGE_HANDOFF,
    parseNpmPackagePublications(publications, execution),
  );
}

if (import.meta.main) await main();
