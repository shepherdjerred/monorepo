import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { automationTestHarness } from "#testing/automation.ts";
import { movieFilesV4Fixture } from "#testing/movie-files-v4.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import {
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
} from "#shared/movie-editions/registry.ts";
import { MovieFilePlanV2Schema } from "#shared/movie-editions/file-plan-v2.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import { inspectAndStageMovieV4 } from "./inspection.ts";

const h = automationTestHarness();
const directories: string[] = [];
let clip: Uint8Array;
let smaller: Uint8Array;
beforeAll(async () => {
  clip = await movieVideoFixture();
  smaller = await movieVideoFixture(1280);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture(
  options: {
    edition?: (typeof MovieEditionKeySchema.options)[number];
    memberName?: string;
    bytes?: Uint8Array;
  } = {},
) {
  const result = await movieFilesV4Fixture(
    h.database(),
    h.context(),
    await h.fixture(),
    { ...options, bytes: options.bytes ?? clip },
  );
  directories.push(result.files.directory);
  return result;
}

test.each(MovieEditionKeySchema.options)(
  "real probe, English/Chinese extraction and staged bytes bind the requested %s edition",
  async (edition) => {
    const f = await fixture({ edition });
    await inspectAndStageMovieV4(f.files.context, f.input);
    const recorded = await h.database().acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.input.attemptId },
    });
    const plan = MovieFilePlanV2Schema.parse(recorded.filePlan);
    const entry = plan.entries[0];
    expect(FilePlanSchema.safeParse(recorded.filePlan).success).toBe(false);
    expect(plan).toMatchObject({
      schemaVersion: 2,
      scope: f.input.scope,
      attemptId: f.attempt.id,
      birth: f.attempt.movieEditionAuthority,
    });
    expect(entry.properties).toMatchObject({
      quality: "WEB-1080p",
      codec: "H264",
      audioLanguages: ["en"],
      sourceQuality: "WEB-1080p",
      movieScope: f.input.scope,
    });
    expect(
      entry.embeddedSubtitles.map((value) => value.language).sort(),
    ).toEqual(["en", "zh-Hans"]);
    const expectedCut =
      edition === "default"
        ? { kind: "standard_unmarked" }
        : { kind: "named", cut: edition };
    expect(entry.editionEvidence.candidate.conclusion).toEqual(expectedCut);
    expect(entry.editionEvidence.member.conclusion).toEqual(expectedCut);
    const label = MOVIE_EDITION_REGISTRY[edition].plexLabel;
    if (edition === "default")
      expect(entry.libraryPath).not.toContain("{edition-");
    else
      for (const component of entry.libraryPath.split("/"))
        expect(component).toContain(`{edition-${label}}`);
    const staged = await readFile(
      path.join(f.files.roots.control, "staging", entry.operationId),
    );
    expect(staged).toEqual(Buffer.from(clip));
    expect(entry.checksum).toBe(
      createHash("sha256").update(staged).digest("hex"),
    );
    expect(
      await Bun.file(
        path.join(f.files.roots.library, entry.libraryPath),
      ).exists(),
    ).toBe(false);
    expect(
      await h
        .database()
        .libraryAsset.count({ where: { editionRootId: f.media.id } }),
    ).toBe(0);
    expect(
      await h.database().releaseCandidate.findUniqueOrThrow({
        where: { id: f.candidate.release.id },
      }),
    ).toEqual(f.candidate.release);
    await expect(
      h.database().acquisitionAttempt.update({
        where: { id: f.attempt.id },
        data: {
          filePlan: {
            ...plan,
            scope: {
              ...plan.scope,
              edition: edition === "default" ? "extended_cut" : "default",
            },
          },
        },
      }),
    ).rejects.toThrow("Versioned movie file plan is immutable");
    await inspectAndStageMovieV4(f.files.context, f.input);
    expect(
      await h.database().acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.input.attemptId },
      }),
    ).toEqual(recorded);
  },
);

test.each([
  [
    "Example.2020.Theatrical.Cut.1080p.WEB-DL.H264.ENG.mkv",
    "edition_evidence_conflict",
  ],
  ["Example.2020.1080p.WEB-DL.H264.ENG.mkv", "edition_candidate_incompatible"],
] as const)(
  "a member labelled %s cannot borrow extended-release cut evidence",
  async (memberName, code) => {
    const f = await fixture({ memberName });
    let probes = 0;
    f.files.context.inspect = async (filename) => {
      probes++;
      return await inspectMedia(filename);
    };
    await expect(
      inspectAndStageMovieV4(f.files.context, f.input),
    ).rejects.toMatchObject({ code });
    expect(probes).toBe(0);
    expect(
      await h
        .database()
        .acquisitionAttempt.findUniqueOrThrow({ where: { id: f.attempt.id } }),
    ).toMatchObject({
      state: "downloading",
      filePlan: null,
      movieEditionAuthority: f.attempt.movieEditionAuthority,
    });
    expect(
      await h
        .database()
        .libraryAsset.count({ where: { editionRootId: f.media.id } }),
    ).toBe(0);
  },
);

test("actual decoded 720p quality cannot satisfy an advertised 1080p movie release", async () => {
  const f = await fixture({ bytes: smaller });
  await expect(
    inspectAndStageMovieV4(f.files.context, f.input),
  ).rejects.toMatchObject({ reason: "measured_quality_rejected" });
  expect(
    await h
      .database()
      .acquisitionAttempt.findUniqueOrThrow({ where: { id: f.attempt.id } }),
  ).toMatchObject({ filePlan: null });
  expect(
    await h
      .database()
      .libraryAsset.count({ where: { editionRootId: f.media.id } }),
  ).toBe(0);
});

async function cancel(f: Awaited<ReturnType<typeof fixture>>) {
  const user = await h
    .database()
    .mediaUser.findUniqueOrThrow({ where: { id: f.result.subjectUserId } });
  await f.commands.cancelMovieEditionRequest(
    { ...user, role: "member" },
    crypto.randomUUID(),
    {
      schemaVersion: 3,
      action: "cancel_request",
      subjectUserId: user.id,
      scope: f.input.scope,
      requestId: f.result.requestId,
      expected: {
        targetVersion: f.result.applied.targetVersion,
        requestVersion: f.result.applied.requestVersion,
        choiceRevision: f.result.applied.choiceRevision,
      },
    },
  );
}

test("cancellation after copying prevents staging acceptance and never publishes library bytes", async () => {
  const f = await fixture();
  f.files.context.checkpoint = async (phase) => {
    if (phase === "staging-prepared") await cancel(f);
  };
  await expect(
    inspectAndStageMovieV4(f.files.context, f.input),
  ).rejects.toMatchObject({ reason: "movie_acquisition_obsolete" });
  const recorded = await h
    .database()
    .acquisitionAttempt.findUniqueOrThrow({ where: { id: f.attempt.id } });
  const entry = MovieFilePlanV2Schema.parse(recorded.filePlan).entries[0];
  expect(recorded.movieEditionAuthority).toEqual(
    f.attempt.movieEditionAuthority,
  );
  const journal = ManifestSchema.parse(
    JSON.parse(
      await readFile(
        path.join(
          f.files.roots.control,
          "journal",
          `${entry.operationId}.json`,
        ),
        "utf8",
      ),
    ),
  );
  expect(journal).toMatchObject({
    phase: "prepared",
    operationId: entry.operationId,
    sha256: entry.checksum,
  });
  expect(
    await Bun.file(
      path.join(f.files.roots.control, "staging", entry.operationId),
    ).exists(),
  ).toBe(false);
  expect(
    await Bun.file(
      path.join(
        f.files.roots.control,
        "staging",
        `${entry.operationId}.partial`,
      ),
    ).bytes(),
  ).toEqual(clip);
  expect(
    await Bun.file(
      path.join(f.files.roots.library, entry.libraryPath),
    ).exists(),
  ).toBe(false);
  expect(
    await h
      .database()
      .libraryAsset.count({ where: { editionRootId: f.media.id } }),
  ).toBe(0);
});

test("staging retains the original invocation observation and sixty-second authority ceiling", async () => {
  const f = await fixture();
  const execution = testPublicationExecution();
  const observed = { ...execution.observed };
  let captures = 0;
  f.files.context.publicationExecution = () => {
    captures++;
    return execution;
  };
  f.files.context.checkpoint = (phase) => {
    if (phase === "staging-prepared")
      vi.spyOn(Date, "now").mockReturnValue(observed.wall + 60_001);
    return Promise.resolve();
  };
  await expect(
    inspectAndStageMovieV4(f.files.context, f.input),
  ).rejects.toMatchObject({ reason: "publication_authority_expired" });
  expect(captures).toBe(1);
  expect(execution.observed).toEqual(observed);
  const recorded = await h
    .database()
    .acquisitionAttempt.findUniqueOrThrow({ where: { id: f.attempt.id } });
  const entry = MovieFilePlanV2Schema.parse(recorded.filePlan).entries[0];
  const journal = ManifestSchema.parse(
    JSON.parse(
      await readFile(
        path.join(
          f.files.roots.control,
          "journal",
          `${entry.operationId}.json`,
        ),
        "utf8",
      ),
    ),
  );
  expect(journal).toMatchObject({
    phase: "prepared",
    operationId: entry.operationId,
    sha256: entry.checksum,
  });
  expect(
    await Bun.file(
      path.join(f.files.roots.control, "staging", entry.operationId),
    ).exists(),
  ).toBe(false);
  expect(
    await Bun.file(
      path.join(
        f.files.roots.control,
        "staging",
        `${entry.operationId}.partial`,
      ),
    ).bytes(),
  ).toEqual(clip);
  expect(
    await Bun.file(
      path.join(f.files.roots.library, entry.libraryPath),
    ).exists(),
  ).toBe(false);
});
