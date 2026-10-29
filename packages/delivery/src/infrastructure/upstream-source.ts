import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  githubSource,
  type VersionCatalogEntry,
} from "@shepherdjerred/version-catalog";
import type { AcquireUpstreamArtifactSchema } from "#shared/contract.ts";
import { sourceArchiveUri } from "#shared/artifact-contract.ts";
import { DeliveryError } from "#domain/error.ts";
import { boundedBody } from "./artifact-stores/oci-registry.ts";

type Input = z.output<typeof AcquireUpstreamArtifactSchema>;
type Transport = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** A reviewed Git source acquisition: the tag the catalog pins and the commit it is said to name. */
export type SourceReview = {
  kind: "source";
  originKey: string;
  name: string;
  tag: string;
  commit: string;
};

const MAX_TARBALL_BYTES = 16 * 1024 * 1024;

function refuse(reason: string): never {
  throw new DeliveryError("INVALID", reason);
}

/** The repository a GitHub source entry names, as its upstream origin records it. */
function sourceRepository(entry: VersionCatalogEntry): string {
  return `https://github.com/${entry.name}`;
}

/**
 * A Git source is a version-catalog GitHub source entry acquired as the
 * tarball of the commit its tag names, stored content-addressed in the
 * Delivery artifact bucket. Nothing is read before this passes.
 */
export function sourceReview(
  input: Input,
  entry: VersionCatalogEntry,
  originKey: string,
): SourceReview {
  const { artifact } = input;
  const { origin } = artifact;
  if (!githubSource(entry) || origin.kind !== "upstream")
    refuse("Source acquisition requires a version-catalog GitHub source");
  if (
    origin.repository !== sourceRepository(entry) ||
    origin.name !== entry.name ||
    origin.commit === undefined ||
    artifact.uri !== sourceArchiveUri(entry.name, artifact.digest)
  )
    refuse(
      "Source acquisition must match the catalog source's repository and name, and store its tarball by digest",
    );
  return {
    kind: "source",
    originKey,
    name: entry.name,
    tag: origin.version,
    commit: origin.commit,
  };
}

const GITHUB_READ_HOSTS: ReadonlySet<string> = new Set([
  "api.github.com",
  "codeload.github.com",
]);

/**
 * The acquisition transport with the API's GitHub read credential on GitHub
 * reads only. Anonymous reads share the egress IP's hourly quota with CI,
 * which a main pipeline can exhaust before its source acquisition runs.
 */
export function githubAuthenticatedTransport(
  token: string | undefined,
  transport: Transport = fetch,
): Transport {
  if (token === undefined) return transport;
  return (url, init) => {
    const target = url instanceof URL ? url : new URL(url);
    if (!GITHUB_READ_HOSTS.has(target.hostname)) return transport(url, init);
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    return transport(url, { ...init, headers });
  };
}

async function githubRead(
  url: string,
  transport: Transport,
  options: { accept?: string; limit: number; label: string },
): Promise<Uint8Array> {
  const response = await transport(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: "manual",
    ...(options.accept === undefined
      ? {}
      : { headers: { accept: options.accept } }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new DeliveryError(
      "PAUSED",
      `Independent ${options.label} read unavailable (${String(response.status)})`,
    );
  }
  return boundedBody(response, options.limit, options.label);
}

/**
 * Independently resolves the tag to its commit on GitHub (an annotated tag
 * resolves to the commit it points at) and requires that commit's tarball to
 * hash to the acquired digest.
 */
export async function verifySource(
  input: Input,
  plan: SourceReview,
  transport: Transport,
) {
  const resolved = new TextDecoder()
    .decode(
      await githubRead(
        `https://api.github.com/repos/${plan.name}/commits/${encodeURIComponent(plan.tag)}`,
        transport,
        {
          accept: "application/vnd.github.sha",
          limit: 1024,
          label: "GitHub tag resolution",
        },
      ),
    )
    .trim();
  if (!/^[a-f0-9]{40}$/u.test(resolved))
    refuse(`GitHub did not resolve ${plan.name}@${plan.tag} to a commit`);
  if (resolved !== plan.commit)
    refuse(
      `${plan.name}@${plan.tag} names commit ${resolved}, not the acquired ${plan.commit}`,
    );
  const tarball = await githubRead(
    `https://codeload.github.com/${plan.name}/tar.gz/${plan.commit}`,
    transport,
    { limit: MAX_TARBALL_BYTES, label: "GitHub commit tarball" },
  );
  const digest = `sha256:${createHash("sha256").update(tarball).digest("hex")}`;
  if (digest !== input.artifact.digest)
    refuse("The commit's tarball differs from the acquired archive digest");
}
