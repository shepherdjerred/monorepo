import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sourceArchiveUri } from "@shepherdjerred/delivery/artifact-contract";
import { DeliveryClientError } from "@shepherdjerred/delivery/client";
import type {
  AcquireUpstreamArtifact,
  ArtifactVersion,
} from "@shepherdjerred/delivery/contract";
import { publishImmutableArchive } from "../artifacts/immutable-archive.ts";
import type {
  ComponentArtifactOptions,
  SourceTransport,
  UpstreamClient,
  UpstreamIntent,
} from "./delivery-upstream-artifacts.ts";

/** Delivery verifies a source tarball up to this size; a larger one never qualifies. */
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

async function githubRead(
  transport: SourceTransport,
  url: string,
  headers: Record<string, string>,
  label: string,
): Promise<Uint8Array> {
  const response = await transport(url, {
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(`${label} failed (${String(response.status)})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_SOURCE_BYTES)
    throw new Error(`${label} exceeds Delivery's 16 MiB source limit`);
  return bytes;
}

/**
 * A GitHub source is acquired as the tarball of the commit its pinned tag
 * names, stored content-addressed in the Delivery artifact bucket. Delivery
 * resolves the tag and hashes the tarball again before it qualifies.
 */
export async function prepareSource(
  intent: UpstreamIntent,
  options: ComponentArtifactOptions,
): Promise<{
  artifact: AcquireUpstreamArtifact["artifact"];
  tarball: Uint8Array;
}> {
  const transport = options.sourceTransport ?? fetch;
  const token = options.githubToken?.();
  const commit = new TextDecoder()
    .decode(
      await githubRead(
        transport,
        `https://api.github.com/repos/${intent.name}/commits/${encodeURIComponent(intent.version)}`,
        {
          accept: "application/vnd.github.sha",
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        `GitHub tag resolution for ${intent.name}@${intent.version}`,
      ),
    )
    .trim();
  if (!/^[a-f0-9]{40}$/u.test(commit))
    throw new Error(
      `GitHub did not resolve ${intent.name}@${intent.version} to a commit`,
    );
  const tarball = await githubRead(
    transport,
    `https://codeload.github.com/${intent.name}/tar.gz/${commit}`,
    {},
    `GitHub tarball of ${intent.name}@${commit}`,
  );
  const digest = `sha256:${createHash("sha256").update(tarball).digest("hex")}`;
  const uri = sourceArchiveUri(intent.name, digest);
  const artifact: AcquireUpstreamArtifact["artifact"] = {
    id: `upstream/${intent.name}/${intent.version}/${digest.slice(7)}`,
    component: intent.component,
    kind: "archive",
    uri,
    digest,
    version: commit,
    origin: {
      kind: "upstream",
      repository: intent.repository,
      name: intent.name,
      version: intent.version,
      commit,
      checksum: digest,
    },
  };
  return { artifact, tarball };
}

export async function publishSource(
  source: Awaited<ReturnType<typeof prepareSource>>,
  options: ComponentArtifactOptions,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "delivery-source-"));
  try {
    const file = path.join(directory, "source.tar.gz");
    await Bun.write(file, source.tarball);
    await (options.publishArchive ?? publishImmutableArchive)({
      uri: source.artifact.uri,
      file,
      readback: path.join(directory, "readback.tar.gz"),
      digest: source.artifact.digest,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function exactQualifiedSource(
  client: UpstreamClient,
  intent: UpstreamIntent,
  source: Awaited<ReturnType<typeof prepareSource>>,
): Promise<ArtifactVersion | undefined> {
  if (client.findQualifiedArtifact === undefined) return undefined;
  try {
    const exact = await client.findQualifiedArtifact({
      serviceId: intent.serviceId,
      component: intent.component,
      kind: "archive",
      digest: source.artifact.digest,
      version: source.artifact.version,
      originKind: "upstream",
    });
    if (
      exact.serviceId !== intent.serviceId ||
      exact.component !== intent.component ||
      exact.kind !== "archive" ||
      exact.digest !== source.artifact.digest ||
      exact.version !== source.artifact.version ||
      exact.uri !== source.artifact.uri ||
      !isDeepStrictEqual(exact.origin, source.artifact.origin)
    )
      throw new Error(
        `Qualified ${intent.component} has a different upstream identity`,
      );
    return exact;
  } catch (error) {
    if (error instanceof DeliveryClientError && error.status === 404)
      return undefined;
    throw error;
  }
}
