import { asRecord } from "../../../scripts/lib/json.ts";
import type { BuildxCommandResult } from "./bake-retry.ts";
import { TransientError } from "../../../scripts/lib/transient-error.ts";
import {
  parseVersionCatalogText,
  serializeVersionCatalog,
} from "../../../packages/version-catalog/src/index.ts";
import {
  ciHandoffConfigFromEnv,
  readRequiredHandoff,
} from "../../../scripts/lib/ci/ci-handoff.ts";
import { ensureAncestor } from "../selectors/ensure-ancestor.ts";
import { UNPUBLISHED_IMAGE_DIGEST } from "../../../scripts/lib/image-pin-catalog.ts";
import { parsePinCandidates } from "../../../scripts/lib/pin-candidates-schema.ts";

const VERSION_CATALOG_PATH = "packages/version-catalog/src/catalog.json";
const SOURCE_OWNED_BOOTSTRAP_SLOTS = new Set([
  "shepherdjerred/scout-for-lol/prod/workflows/stable",
  "shepherdjerred/scout-for-lol/prod/workflows/candidate",
]);

export type LiveCatalogExecutor = (
  command: readonly string[],
) => Promise<BuildxCommandResult>;

function releaseNumber(value: string): bigint {
  const match = /^2\.0\.0-([1-9]\d*)@sha256:[a-f\d]{64}$/.exec(value);
  if (match?.[1] === undefined) {
    throw new Error(`Invalid internal image release pin: ${value}`);
  }
  return BigInt(match[1]);
}

/**
 * Reconstruct a completed release, then retain its published pins in current
 * the build catalog. Deployment selections live in Delivery PostgreSQL;
 * this catalog is producer metadata for unchanged-image reuse only.
 * Historical Scout production slots are source bootstrap inputs only.
 * They never select or override the runtime worker pool retained in PostgreSQL.
 * A no-target release writes this catalog back to the handoff, so retention
 * survives any number of consecutive no-target or partial-image builds.
 * Locally published entries remain owned by current source, including their
 * unpublished bootstrap markers. They cannot appear in CI pin candidates.
 */
export function retainPublishedImagePins(
  currentSource: string,
  previousSource: string,
  candidatesSource: string,
): string {
  const current = parseVersionCatalogText(currentSource);
  const previous = parseVersionCatalogText(previousSource);
  const batch = parsePinCandidates(candidatesSource);
  const localKeys = new Set(
    [...current.entries, ...previous.entries]
      .filter((entry) => entry.imagePublisher === "local")
      .map((entry) => entry.name),
  );
  const published = new Map(
    previous.entries
      .filter(
        (entry) =>
          entry.category === "internal-image" &&
          entry.artifactType === "image" &&
          !localKeys.has(entry.name),
      )
      .map((entry) => [entry.name, entry.value]),
  );
  for (const [key, candidate] of Object.entries(batch.candidates)) {
    if (SOURCE_OWNED_BOOTSTRAP_SLOTS.has(key)) {
      throw new Error(
        `CI candidate contains source-owned bootstrap image key ${key}`,
      );
    }
    if (localKeys.has(key)) {
      throw new Error(
        `CI candidate contains locally published image key ${key}`,
      );
    }
    if (!published.has(key)) {
      throw new Error(
        `Published candidate contains unknown internal image key ${key}`,
      );
    }
    if (candidate.version !== `2.0.0-${batch.buildNumber.toString()}`) {
      throw new Error(
        `Published candidate version does not match its build for ${key}`,
      );
    }
    published.set(key, `${candidate.version}@${candidate.digest}`);
  }
  return serializeVersionCatalog({
    ...current,
    entries: current.entries.map((entry) => {
      const value = published.get(entry.name);
      if (
        value === undefined ||
        entry.category !== "internal-image" ||
        entry.artifactType !== "image"
      )
        return entry;
      // The declared bootstrap marker may be replaced by a verified first
      // publication. Published values themselves still require a real release.
      const currentBuild =
        entry.value === `0.0.0@${UNPUBLISHED_IMAGE_DIGEST}`
          ? 0n
          : releaseNumber(entry.value);
      // Prepared services can remain unpublished across unrelated releases.
      // Their marker cannot replace an already published pin in current main.
      if (value === `0.0.0@${UNPUBLISHED_IMAGE_DIGEST}`) return entry;
      const publishedBuild = releaseNumber(value);
      if (currentBuild === publishedBuild && entry.value !== value) {
        throw new Error(
          `Conflicting published image pins for ${entry.name} at release ${currentBuild.toString()}`,
        );
      }
      // CI does not mint these historical source bootstrap slots. They are
      // unrelated to Delivery's accepted version set or current native routing.
      if (SOURCE_OWNED_BOOTSTRAP_SLOTS.has(entry.name)) return entry;
      return publishedBuild > currentBuild ? { ...entry, value } : entry;
    }),
  });
}

export async function readPublishedVersionCatalogSource(
  currentSource: string,
  pipelineNumber: string,
  readHandoff: (key: string, pipelineNumber: string) => Promise<string> = (
    key,
    number,
  ) =>
    readRequiredHandoff(key, {
      ...ciHandoffConfigFromEnv(),
      pipelineNumber: number,
    }),
): Promise<string> {
  if (
    !/^[1-9]\d*$/.test(pipelineNumber) ||
    !Number.isSafeInteger(Number(pipelineNumber))
  ) {
    throw new Error("Image release pipeline must be a positive safe integer");
  }
  const [catalog, candidates] = await Promise.all([
    readHandoff("version-catalog", pipelineNumber),
    readHandoff("pin-candidates", pipelineNumber),
  ]);
  return retainPublishedImagePins(currentSource, catalog, candidates);
}

async function imageReleaseBase(
  currentCommit: string,
  executor: LiveCatalogExecutor,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<{ commit: string; pipelineNumber: string } | undefined> {
  const commit = environment["CI_LAST_IMAGE_RELEASE_COMMIT"];
  const pipelineNumber = environment["CI_LAST_IMAGE_RELEASE_PIPELINE"];
  // A legacy extension's commit alone cannot address its published pins.
  // Without a complete baseline, callers must build every image target.
  if (pipelineNumber === undefined || pipelineNumber.length === 0)
    return undefined;
  if (
    !/^[1-9]\d*$/.test(pipelineNumber) ||
    !Number.isSafeInteger(Number(pipelineNumber))
  ) {
    throw new Error("Image release pipeline must be a positive safe integer");
  }
  if (commit === undefined || commit.length === 0) {
    throw new Error("Image release pipeline has no corresponding commit");
  }
  const canFetch =
    environment["CI_PIPELINE_EVENT"] === "push" ||
    environment["CI_PIPELINE_EVENT"] === "manual";
  // The extension's answer still has to be an ancestor of this checkout.
  return (await ensureAncestor(commit, currentCommit, executor, canFetch))
    ? { commit, pipelineNumber }
    : undefined;
}

export async function lastSuccessfulImageReleaseCommit(
  currentCommit: string,
  executor: LiveCatalogExecutor,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<string | undefined> {
  const base = await imageReleaseBase(currentCommit, executor, environment);
  return base?.commit;
}

export async function resolveImageReleaseCatalog(
  currentCommit: string,
  executor: LiveCatalogExecutor,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
  readHandoff?: (key: string, pipelineNumber: string) => Promise<string>,
): Promise<{ catalog: string; baseCommit: string | undefined }> {
  // Fetch first so both catalog selection and ancestry use current origin/main.
  const live = await readLiveVersionCatalogSource(executor);
  const source = await executor([
    "git",
    "show",
    `${currentCommit}:${VERSION_CATALOG_PATH}`,
  ]);
  if (source.exitCode !== 0) {
    throw new Error("Unable to read the build source version catalog");
  }
  const buildCatalog = parseVersionCatalogText(source.stdout);
  const liveCatalog = parseVersionCatalogText(live);
  const liveImages = new Map(
    liveCatalog.entries
      .filter(
        (entry) =>
          entry.category === "internal-image" && entry.artifactType === "image",
      )
      .map((entry) => [entry.name, entry.value]),
  );
  // Upstream versions can have matching checksums or configuration in this
  // checkout. Only internal image values may advance independently of source.
  const current = serializeVersionCatalog({
    ...buildCatalog,
    entries: buildCatalog.entries.map((entry) => {
      const value = liveImages.get(entry.name);
      return value !== undefined &&
        entry.category === "internal-image" &&
        entry.artifactType === "image"
        ? { ...entry, value }
        : entry;
    }),
  });
  const base = await imageReleaseBase(currentCommit, executor, environment);
  return {
    baseCommit: base?.commit,
    catalog:
      base === undefined
        ? current
        : await readPublishedVersionCatalogSource(
            current,
            base.pipelineNumber,
            readHandoff,
          ),
  };
}

/**
 * Reads the version catalog from live origin/main. The image push records it
 * as build metadata and derives Temporal Workflow candidate pins from it.
 *
 * Published pins from the completed baseline are retained before selection
 * and candidate derivation. This producer inventory does not choose deployed
 * versions or write release selections back to Git.
 */
export async function readLiveVersionCatalogSource(
  executor: LiveCatalogExecutor,
): Promise<string> {
  // The image workflow starts from a depth-one clone. This bounded fetch
  // supplies both the live catalog and the prior image-release ancestry.
  const fetched = await executor([
    "git",
    "fetch",
    "--no-tags",
    "--depth=100",
    "origin",
    "main",
  ]);
  if (fetched.exitCode !== 0) {
    throw new TransientError(
      "Unable to refresh origin/main before reading the version catalog",
    );
  }
  const catalog = await executor([
    "git",
    "show",
    `origin/main:${VERSION_CATALOG_PATH}`,
  ]);
  if (catalog.exitCode !== 0) {
    throw new TransientError("Unable to read the live version catalog");
  }
  const parsed = asRecord(JSON.parse(catalog.stdout));
  if (parsed === null || !Array.isArray(parsed["entries"])) {
    throw new Error("Live version catalog has an invalid shape");
  }
  for (const entryValue of parsed["entries"]) {
    const entry = asRecord(entryValue);
    if (
      entry === null ||
      typeof entry["name"] !== "string" ||
      typeof entry["value"] !== "string"
    ) {
      throw new Error("Live version catalog has an invalid entry");
    }
  }
  return catalog.stdout;
}
