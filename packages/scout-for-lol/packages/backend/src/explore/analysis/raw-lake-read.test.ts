import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ensureLakeScaffold,
  buildDirPath,
  publishBuild,
} from "#src/report-lake/paths.ts";
import { lakeSchemaFingerprint } from "#src/report-lake/schema.ts";
import { commitStagingGeneration } from "#src/report-lake/staging/generations.ts";
import { rawDocumentRow } from "#src/report-lake/staging/raw-documents.ts";
import { readRawDocuments } from "./raw-lake-read.ts";
import { captureAnalysisGeneration } from "./lake-generation.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

test("returns complete raw JSON and identity provenance beyond flattened timeline columns", async () => {
  const lakeDir = await mkdtemp(path.join(os.tmpdir(), "scout-raw-parity-"));
  dirs.push(lakeDir);
  await ensureLakeScaffold(lakeDir);
  const build = buildDirPath(lakeDir, "1-test");
  await mkdir(build);
  await Bun.write(
    path.join(build, "manifest.json"),
    JSON.stringify({ schemaFingerprint: lakeSchemaFingerprint() }),
  );
  await publishBuild(lakeDir, "1-test");
  const before = await captureAnalysisGeneration(lakeDir);
  const document = {
    metadata: { matchId: "NA1_42", participants: ["original"] },
    info: {
      frames: [
        {
          events: [
            {
              type: "CHAMPION_KILL",
              victimDamageReceived: [{ futureDamage: 42 }],
              optionalNull: null,
            },
            { type: "FUTURE_EVENT", nested: [3, 1, 2] },
          ],
          participantFrames: {
            "1": {
              championStats: { health: 100 },
              damageStats: { futureDamage: 99 },
            },
          },
        },
      ],
    },
  };
  const row = rawDocumentRow({
    kind: "timeline",
    matchId: "NA1_42",
    document,
    capturedAt: new Date("2026-10-03T00:00:00Z"),
    identityMap: new Map([
      ["original", "normalized"],
      ["unrelated", "hidden"],
    ]),
    source: {
      kind: "s3",
      key: "timeline/NA1_42.json",
      digest: "original-digest",
    },
  });
  await commitStagingGeneration({
    lakeDir,
    projectionKind: "timeline",
    naturalId: "NA1_42",
    observedAt: new Date("2026-10-03T00:00:00Z"),
    files: [
      { table: "raw_documents", content: JSON.stringify(row) + "\n" },
      ...(
        [
          "timeline_events",
          "timeline_event_participants",
          "timeline_participant_frames",
          "timeline_coverage",
        ] as const
      ).map((table) => ({ table, content: "\n" })),
    ],
  });
  const result = await readRawDocuments({
    lakeDir,
    matchIds: ["NA1_42"],
    kinds: ["timeline"],
    signal: new AbortController().signal,
  });
  expect(result.generation).not.toBe(before.id);
  expect(result.documents).toHaveLength(1);
  expect(result.documents[0]).toMatchObject({
    document,
    identityMap: { original: "normalized" },
    digest: "original-digest",
    sourceKey: "timeline/NA1_42.json",
  });
});

test("does not replicate spectator credentials into analytical data", () => {
  const row = rawDocumentRow({
    kind: "prematch",
    matchId: "NA1_42",
    document: {
      observers: { encryptionKey: "fixture-credential" },
      future: { values: [null, 1] },
    },
    capturedAt: new Date(),
  });
  expect(JSON.parse(row.document_json)).toEqual({
    future: { values: [null, 1] },
  });
});
