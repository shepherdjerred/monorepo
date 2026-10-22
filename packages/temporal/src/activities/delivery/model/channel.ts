import { ApplicationFailure, Context } from "@temporalio/activity";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  ArtifactVersion,
  DeploymentDetail,
  EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { requireEnv, run } from "@shepherdjerred/root-scripts/lib/run.ts";
import { SEAWEEDFS_ENDPOINT } from "@shepherdjerred/root-scripts/lib/seaweedfs.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import {
  NPM_STAGING_TAG,
  npmRegistry,
  type NpmRegistry,
  type Packument,
} from "#lib/delivery/model/npm-registry.ts";
import type { ChannelRecipe } from "#lib/delivery/model/recipe.ts";
import { recordStage, stageOf } from "./stages.ts";

const READBACK_ATTEMPTS = 30;
const READBACK_INTERVAL_MS = 2000;

/** The store, the artifact store and the registry readback a channel step uses. */
export type ChannelEffects = {
  record: typeof recordStage;
  artifact: (artifact: ArtifactVersion) => Promise<Uint8Array>;
  registry: Pick<NpmRegistry, "packument" | "tarball" | "setTag" | "removeTag">;
  publish: (tarball: Uint8Array, tag: string) => Promise<void>;
  wait: (milliseconds: number) => Promise<void>;
};

function signal() {
  return Context.current().cancellationSignal;
}

/** The frozen tarball from the Delivery artifact store, with the reader the site step uses. */
async function readArtifact(artifact: ArtifactVersion): Promise<Uint8Array> {
  const match = /^s3:\/\/([^/]+)\/(.+)$/u.exec(artifact.uri);
  if (match?.[1] === undefined || match[2] === undefined)
    throw new Error(`Channel artifact ${artifact.id} is not an s3 object`);
  const client = new Bun.S3Client({
    endpoint: SEAWEEDFS_ENDPOINT,
    region: "us-east-1",
    bucket: match[1],
    accessKeyId: requireEnv("DELIVERY_SITE_ACTIVATOR_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("DELIVERY_SITE_ACTIVATOR_SECRET_ACCESS_KEY"),
  });
  return new Uint8Array(await client.file(match[2]).arrayBuffer());
}

/** `bun publish` of the exact tarball under the staging dist-tag. */
async function publishTarball(tarball: Uint8Array, tag: string) {
  const token = npmRegistry({ token: Bun.env["NPM_TOKEN"] }).token();
  const scratch = await mkdtemp(path.join(tmpdir(), "delivery-channel-"));
  try {
    const file = path.join(scratch, "package.tgz");
    await Bun.write(file, tarball);
    // The child sees only the npm credential, never the executor's own.
    await run(["bun", "publish", file, "--tag", tag, "--access", "public"], {
      cwd: scratch,
      inheritEnv: false,
      env: { PATH: requireEnv("PATH"), HOME: scratch, NPM_CONFIG_TOKEN: token },
      signal: signal(),
    });
  } finally {
    await rm(scratch, { recursive: true });
  }
}

const external: ChannelEffects = {
  record: recordStage,
  artifact: readArtifact,
  get registry() {
    return npmRegistry({ token: Bun.env["NPM_TOKEN"], signal: signal() });
  },
  publish: publishTarball,
  wait: async (milliseconds) => {
    await Bun.sleep(milliseconds);
  },
};

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function channelArtifact(
  current: DeploymentDetail,
  recipe: ChannelRecipe,
): ArtifactVersion {
  const artifact = current.versionSet.components[recipe.artifactComponent];
  if (artifact?.kind !== "archive")
    throw new Error(
      `Channel ${recipe.name} publishes a package archive; the selection has no ${recipe.artifactComponent}`,
    );
  return artifact;
}

/** Poll the registry's own state until `observe` reports it; null when it never does. */
async function poll<T>(
  effects: ChannelEffects,
  observe: () => Promise<T | null>,
): Promise<T | null> {
  for (let attempt = 0; attempt < READBACK_ATTEMPTS; attempt++) {
    const observed = await observe();
    if (observed !== null) return observed;
    await effects.wait(READBACK_INTERVAL_MS);
  }
  return null;
}

async function readback<T>(
  effects: ChannelEffects,
  observe: () => Promise<T | null>,
  what: string,
): Promise<T> {
  const observed = await poll(effects, observe);
  if (observed === null)
    throw new Error(`The npm registry never showed ${what}`);
  return observed;
}

/** The registry's record of the version, once its served bytes match the artifact. */
async function servedVersion(
  effects: ChannelEffects,
  packument: Packument | null,
  artifact: ArtifactVersion,
) {
  const published = packument?.versions[artifact.version];
  if (published === undefined) return null;
  const served = sha256(await effects.registry.tarball(published.dist.tarball));
  if (served !== artifact.digest)
    throw ApplicationFailure.nonRetryable(
      `The registry serves different bytes for ${artifact.version} (${served}); a published version is never replaced`,
      "DeliveryChannelVersionDiffers",
    );
  return published.dist;
}

function channelEvidence(
  input: {
    operationId: string;
    recipe: ChannelRecipe;
    artifact: ArtifactVersion;
    dist: { integrity: string; shasum: string; tarball: string };
  },
  extra: Record<string, unknown>,
): EvidenceInput[] {
  const { operationId, recipe, artifact, dist } = input;
  return [
    {
      kind: "reconciliation",
      operationId,
      url: dist.tarball,
      summary: JSON.stringify({
        adapter: "channel",
        store: recipe.store,
        name: recipe.name,
        version: artifact.version,
        sha256: artifact.digest,
        integrity: dist.integrity,
        shasum: dist.shasum,
        ...extra,
      }),
    },
  ];
}

/**
 * Sub-step one (section 5): publish the version if the store lacks it,
 * under the staging tag, and read back that the registry serves exactly the
 * artifact's bytes. A published version is never removed or replaced; a
 * rollback finds it present and only proves it.
 */
async function publishStep(
  current: DeploymentDetail,
  recipe: ChannelRecipe,
  key: string,
  effects: ChannelEffects,
) {
  const artifact = channelArtifact(current, recipe);
  const operationId = deliveryOperationId(
    `${current.deployment.id}:channel-publish`,
  );
  const intent = stageOf(current, key) !== undefined;
  const served = async () =>
    await servedVersion(
      effects,
      await effects.registry.packument(recipe.name),
      artifact,
    );
  // A recorded intent may already have published: read back before acting.
  let dist = intent ? await poll(effects, served) : await served();
  const published = dist === null;
  if (dist === null) {
    if (!intent) await effects.record(current, key, "running", { operationId });
    const bytes = await effects.artifact(artifact);
    if (sha256(bytes) !== artifact.digest)
      throw new Error("Stored package bytes differ from the artifact digest");
    await effects.publish(bytes, NPM_STAGING_TAG);
    dist = await readback(
      effects,
      served,
      `${recipe.name}@${artifact.version}`,
    );
  }
  await effects.record(current, key, "succeeded", {
    operationId,
    evidence: channelEvidence(
      { operationId, recipe, artifact, dist },
      { published },
    ),
  });
}

/**
 * Sub-step two: move the channel's pointer to the selected version, read
 * back that the registry resolves the pointer to it, and drop the staging
 * tag. A rollback moves the pointer back the same way.
 */
async function pointerStep(
  current: DeploymentDetail,
  recipe: ChannelRecipe,
  key: string,
  effects: ChannelEffects,
) {
  const artifact = channelArtifact(current, recipe);
  const operationId = deliveryOperationId(
    `${current.deployment.id}:channel-pointer`,
  );
  const before = await effects.registry.packument(recipe.name);
  const dist = await servedVersion(effects, before, artifact);
  if (dist === null)
    throw new Error(
      `${recipe.name}@${artifact.version} is not published; the publish step settles first`,
    );
  if (before?.["dist-tags"][recipe.pointer] !== artifact.version) {
    if (stageOf(current, key) === undefined)
      await effects.record(current, key, "running", { operationId });
    await effects.registry.setTag(
      recipe.name,
      recipe.pointer,
      artifact.version,
    );
  }
  const after = await readback(
    effects,
    async () => {
      const packument = await effects.registry.packument(recipe.name);
      return packument?.["dist-tags"][recipe.pointer] === artifact.version
        ? packument
        : null;
    },
    `${recipe.pointer} on ${artifact.version}`,
  );
  if (after["dist-tags"][NPM_STAGING_TAG] !== undefined)
    await effects.registry.removeTag(recipe.name, NPM_STAGING_TAG);
  await effects.record(current, key, "succeeded", {
    operationId,
    evidence: channelEvidence(
      { operationId, recipe, artifact, dist },
      { pointer: recipe.pointer },
    ),
  });
}

/** A channel recipe's step (section 5, X12); npm is the store built so far. */
export async function runChannelStep(
  current: DeploymentDetail,
  recipe: ChannelRecipe,
  step: { key: string; phase: "publish" | "pointer" },
  effects: ChannelEffects = external,
): Promise<void> {
  if (recipe.store !== "npm")
    throw ApplicationFailure.nonRetryable(
      `This executor version has no ${recipe.store} channel adapter; the deployment stays owned for inspection`,
      "DeliveryModelAdapterMissing",
    );
  if (step.phase === "publish")
    await publishStep(current, recipe, step.key, effects);
  else await pointerStep(current, recipe, step.key, effects);
}
