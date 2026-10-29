/**
 * Publishing a stack archive is kept apart from describing one: this module
 * holds the only `requireEnv` reads, so registration code can import the
 * archive identity helpers without inheriting the publisher credential
 * contract that `check-ci-env` enforces per step.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactInputSchema } from "@shepherdjerred/delivery/contract";
import type { TofuStack } from "@shepherdjerred/ops-model/platform-policy.ts";
import { publishImmutableArchive } from "./artifacts/immutable-archive.ts";
import { requireEnv } from "./run.ts";
import { createTofuStackArchive } from "./tofu-archive.ts";
import {
  tofuArchiveArtifactId,
  tofuArchiveComponent,
  tofuArchiveUri,
} from "./tofu-archive-identity.ts";

/** Publish if absent, confirm by readback, and record the artifact for the handoff writer. */
export async function publishTofuStackArchive(input: {
  stack: TofuStack;
  repoRoot: string;
  metadataDirectory: string;
}): Promise<void> {
  const scratch = await mkdtemp(path.join(tmpdir(), "tofu-archive-publish-"));
  try {
    const archive = path.join(scratch, "stack.tar");
    const { digest } = await createTofuStackArchive(
      input.stack,
      input.repoRoot,
      archive,
    );
    const uri = tofuArchiveUri(input.stack, digest);
    await publishImmutableArchive({
      uri,
      digest,
      file: archive,
      readback: path.join(scratch, "readback.tar"),
    });
    const pipelineNumber = Number(requireEnv("CI_PIPELINE_NUMBER"));
    const repositoryId = Number(requireEnv("CI_REPO_ID"));
    const artifact = ArtifactInputSchema.parse({
      id: tofuArchiveArtifactId(repositoryId, pipelineNumber, input.stack),
      component: tofuArchiveComponent(input.stack),
      kind: "archive",
      uri,
      digest,
      runtimeDigests: [],
      requires: {},
      version: `build-${String(pipelineNumber)}`,
    });
    await mkdir(input.metadataDirectory, { recursive: true });
    await Bun.write(
      path.join(input.metadataDirectory, `${input.stack}.json`),
      `${JSON.stringify(artifact)}\n`,
    );
  } finally {
    await rm(scratch, { recursive: true });
  }
}
