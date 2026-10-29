import { z } from "zod";
import type { FetchTransport } from "#integrations/http.ts";
import type { SourceInventory } from "#domain/resolved-contract.ts";
import {
  inventoryProfiles,
  type InventorySource,
} from "#migration/source-inventory.ts";
import {
  ProfileSnapshotSchema,
  snapshotHash,
} from "#migration/profile-import.ts";
import { captureInstalledCatalog } from "./manager.ts";
import { omitPrivateEpisodeTitles } from "./privacy.ts";
import { captureStage, PrivateCaptureError } from "./diagnostics.ts";
import {
  PrivateCaptureManifestSchema,
  type InstalledCapture,
} from "./contract.ts";
import {
  createPrivateCaptureDirectory,
  assertPrivateCaptureContent,
} from "./private.ts";

/** Installed observations only: no candidate generation, label generation or synthetic probe filling. */
export async function capturePrivateInstalledCorpus(input: {
  directory: string;
  worktree: string;
  sources: readonly InventorySource[];
  transport?: FetchTransport;
}) {
  if (
    input.sources.length !== 2 ||
    input.sources.filter((source) => source.source === "radarr").length !== 1 ||
    input.sources.filter((source) => source.source === "sonarr").length !== 1
  )
    throw new Error(
      "Capture requires exactly one Radarr and one Sonarr source",
    );
  const output = await captureStage(
    { source: "local", stage: "destination" },
    () => createPrivateCaptureDirectory(input.directory, input.worktree),
  );
  const startedAt = new Date().toISOString();
  const credentials = input.sources.map((source) => source.apiKey);
  const installed: InstalledCapture[] = [];
  const inventories: SourceInventory[] = [];
  const sources: z.infer<typeof PrivateCaptureManifestSchema>["sources"] = [];
  for (const source of input.sources.toSorted((a, b) =>
    a.source.localeCompare(b.source),
  )) {
    const before = await captureStage(
      { source: source.source, stage: "profiles_before" },
      () => inventoryProfiles(source, input.transport),
    );
    const observedCatalog = await captureInstalledCatalog(
      source,
      input.transport,
    );
    const after = await captureStage(
      { source: source.source, stage: "profiles_after" },
      () => inventoryProfiles(source, input.transport),
    );
    if (
      before.version !== observedCatalog.sourceVersion ||
      snapshotHash(z.json().parse(before)) !==
        snapshotHash(z.json().parse(after))
    )
      throw new PrivateCaptureError({
        source: source.source,
        stage: "coherence",
        reason: "changed",
      });
    const roots =
      observedCatalog.source === "radarr"
        ? observedCatalog.movies
        : observedCatalog.series;
    const profileIds = new Set(before.profiles.map((profile) => profile.id));
    if (roots.some((root) => !profileIds.has(root.qualityProfileId)))
      throw new PrivateCaptureError({
        source: source.source,
        stage: "coherence",
        reason: "missing_reference",
      });
    await captureStage(
      { source: source.source, stage: "sanitization", artifact: "profiles" },
      () => {
        assertPrivateCaptureContent(before, credentials);
      },
    );
    const catalog = await captureStage(
      { source: source.source, stage: "sanitization", artifact: "installed" },
      () => omitPrivateEpisodeTitles(observedCatalog, credentials),
    );
    await captureStage(
      { source: source.source, stage: "sanitization", artifact: "installed" },
      () => {
        assertPrivateCaptureContent(catalog, credentials);
      },
    );
    installed.push(catalog);
    inventories.push(before);
    sources.push({
      source: source.source,
      sourceVersion: before.version,
      catalogRecords:
        roots.length +
        (catalog.source === "sonarr" ? catalog.episodes.length : 0),
      installedFiles: catalog.files.length,
      profiles: before.profiles.length,
      privacyOmissions: catalog.privacyOmissions.length,
    });
  }
  const completedAt = new Date().toISOString();
  const profiles = ProfileSnapshotSchema.parse({
    capturedAt: completedAt,
    inventories,
  });
  // Validate every artifact before the first body write, including literal credential strings.
  await captureStage(
    { source: "local", stage: "sanitization", artifact: "profiles" },
    () => {
      assertPrivateCaptureContent(profiles, credentials);
    },
  );
  await captureStage(
    { source: "local", stage: "sanitization", artifact: "installed" },
    () => {
      assertPrivateCaptureContent(installed, credentials);
    },
  );
  const profileArtifact = await captureStage(
    { source: "local", stage: "persistence", artifact: "profiles" },
    () => output.write("profiles.json", profiles, credentials),
  );
  const installedArtifact = await captureStage(
    { source: "local", stage: "persistence", artifact: "installed" },
    () => output.write("installed.json", installed, credentials),
  );
  const manifest = PrivateCaptureManifestSchema.parse({
    schemaVersion: 2,
    stage: "installed-catalog-unlabelled",
    startedAt,
    completedAt,
    sanitization: "allowlisted-boundaries-v1",
    privacy: {
      policy: "optional-episode-title-v1",
      omittedOptionalFields: installed.reduce(
        (count, capture) => count + capture.privacyOmissions.length,
        0,
      ),
    },
    profiles: profileArtifact,
    installed: installedArtifact,
    sources,
    observations: {
      releaseCandidates: "not_captured",
      torrentMembers: "not_captured",
      completion: "not_captured",
      probes: "not_captured",
      independentLabels: "not_authored",
    },
  });
  await captureStage(
    { source: "local", stage: "persistence", artifact: "manifest" },
    () => output.write("capture-manifest.json", manifest, credentials),
  );
  return {
    stage: manifest.stage,
    sources: manifest.sources,
    observations: manifest.observations,
    privacy: manifest.privacy,
  };
}
