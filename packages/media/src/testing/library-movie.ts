import path from "node:path";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import { handoffFixture } from "#automation/handoff/test-fixture.ts";
import { applyPreparedHandoff } from "#automation/handoff/apply.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";
import { PrepareLibraryHandoffV2Schema } from "#shared/handoff-v2.ts";
import {
  MOVIE_EDITION_REGISTRY,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { SubtitleSourceProfileSchema } from "#shared/migration-subtitles.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { createAutomationTestContext } from "./automation.ts";

/** Actual reviewed handoff and initial owner; the adopted file has no download attempt. */
export async function adoptedMovieFixture(
  db: Database,
  options: { bytes: Uint8Array; edition: MovieEditionKey },
  directoryCreated: (path: string) => void,
) {
  const label = MOVIE_EDITION_REGISTRY[options.edition].plexLabel;
  const f = await handoffFixture(db, {
    bytes: options.bytes,
    initialEdition: options.edition,
    fileName: `Synthetic Film (2020)${options.edition === "default" ? "" : ` {edition-${label}}`}.1080p.ENG.mkv`,
    extendReport({ report, manifest, target }) {
      directoryCreated(path.dirname(path.dirname(target)));
      const manager = manifest.captures.find(
        (capture) => capture.sourceKind === "radarr",
      );
      const source = report.entries.find((entry) => entry.kind === "media");
      if (manager === undefined || source === undefined)
        throw new Error("Initial library capture fixture missing");
      const captureHash = snapshotHash({ bazarrPolicy: target });
      manifest.captures.push({
        captureId: crypto.randomUUID(),
        captureHash,
        sourceKind: "bazarr",
        sourceInstanceId: snapshotHash("library-policy-bazarr"),
      });
      const sourceProfile = SubtitleSourceProfileSchema.parse({
        profileId: 7,
        cutoff: null,
        originalFormat: 0,
        hasConstraints: false,
        constraintHash: snapshotHash([]),
        items: [
          {
            id: 1,
            language: "en",
            forced: "False",
            hi: "False",
            audio_exclude: "False",
            audio_only_include: "False",
          },
        ],
      });
      const record = {
        kind: "subtitle_preference" as const,
        sourceId: "policy1",
        mediaSourceId: "radarr:1",
        languages: ["en"],
        forced: false,
        hearingImpaired: false,
        sourceProfile,
        managerReference: {
          kind: "radarr" as const,
          sourceMediaId: "1",
          sourceInstanceId: manager.sourceInstanceId,
          binding: "owner_declared" as const,
        },
      };
      report.entries.push({
        ...source,
        kind: record.kind,
        sourceId: record.sourceId,
        sourceRecord: record,
        captureHash,
        provenanceKey: snapshotHash({ policy: target }),
        observationHash: snapshotHash(z.json().parse(record)),
      });
      return Promise.resolve();
    },
    prepareRequest({ request, report }) {
      const files = report.entries.filter((entry) => entry.kind === "file");
      return PrepareLibraryHandoffV2Schema.parse({
        ...request,
        schemaVersion: 2,
        purpose: "migration",
        selected: report.entries
          .filter((entry) =>
            ["file", "subtitle_preference"].includes(entry.kind),
          )
          .map((entry) => ({
            provenanceKey: entry.provenanceKey,
            evidenceHash: entry.observationHash,
          })),
        movies: files.map((file) => ({
          provenanceKey: file.provenanceKey,
          edition: options.edition,
          resolution: { kind: "conventional" },
        })),
      });
    },
  });
  f.context.files.inspect = inspectMedia;
  const ready = await f.ready();
  const receiptId = await applyPreparedHandoff(
    f.context,
    ready.input,
    ready.prepared,
  );
  // Preserve the library's existing sandbox paths; worker-owned control artifacts
  // retain the same canonical namespace used by actual Files receipts.
  f.context.files.pathMapping = {
    canonical(kind, root, relative) {
      return root === "control"
        ? path.join(`/data/${kind}/.media-control`, relative)
        : path.join(f.context.files.roots[kind][root], relative);
    },
    local(stored) {
      for (const kind of ["movies", "tv"] as const) {
        const prefix = `/data/${kind}/.media-control/`;
        if (stored.startsWith(prefix))
          return path.join(
            f.context.files.roots[kind].control,
            stored.slice(prefix.length),
          );
      }
      return stored;
    },
  };
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { path: f.target },
  });
  const scope = {
    rootMediaId: f.network.media.id,
    mediaId: f.network.media.id,
    edition: options.edition,
  };
  return {
    ...f,
    db,
    asset,
    scope,
    receiptId,
    networkContext: createAutomationTestContext(db, f.network.context.cipher),
  };
}
