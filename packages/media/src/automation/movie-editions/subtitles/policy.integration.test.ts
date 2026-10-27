import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieFilesV4Fixture } from "#testing/movie-files-v4.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { MovieSubtitleOperationV4Schema } from "#shared/movie-editions/subtitles-v4.ts";
import { inspectAndStageMovieV4 } from "#automation/files/movie-editions/inspection.ts";
import { promoteMovieV4 } from "#automation/files/movie-editions/publication.ts";
import { installMovieSubtitlesV4 } from "#automation/files/movie-editions/subtitles.ts";
import { queueMovieSubtitleTargetsV4 } from "./queue.ts";
import { findMovieSubtitlesV4 } from "./network.ts";
import { currentMovieSubtitleWorkV4 } from "./authority.ts";
import { subtitleTargetsReady } from "#automation/subtitles/authority.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readMovieSubtitleReceiptV4 } from "#infrastructure/movie-editions/subtitle-receipt.ts";
import { currentMovieSubtitlePolicies } from "#infrastructure/movie-editions/subtitle-policy.ts";
import type { SubtitlePolicyTargetSchema } from "#shared/subtitle-policy.ts";
import { fromOpenSubtitles } from "#automation/subtitle-sources.ts";
import type { FetchTransport } from "#integrations/http.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";

const h = automationTestHarness();
const directories: string[] = [];
const access = { serverMachineId: "fixture-server", movieSectionId: "1" };
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture(
  options: {
    bytes?: Uint8Array;
    beforeInspection?: (
      f: Awaited<ReturnType<typeof movieFilesV4Fixture>>,
    ) => Promise<void>;
  } = {},
) {
  const db = h.database();
  const f = await movieFilesV4Fixture(db, h.context(), await h.fixture(), {
    bytes: options.bytes ?? bytes,
  });
  directories.push(f.files.directory);
  await options.beforeInspection?.(f);
  await inspectAndStageMovieV4(f.files.context, f.input);
  await promoteMovieV4(f.files.context, f.input);
  const coverage = await db.assetCoverage.findFirstOrThrow({
    where: {
      mediaId: f.media.id,
      edition: f.input.scope.edition,
      current: true,
    },
  });
  const assetId = coverage.assetId;
  const queue = () =>
    db.$transaction((tx) =>
      queueMovieSubtitleTargetsV4(tx, {
        scope: f.input.scope,
        assetId,
        epoch: 0,
        access,
      }),
    );
  const work = () =>
    currentMovieSubtitleWorkV4(
      db,
      { scope: f.input.scope, assetId, epoch: 0, access },
      new PublicationAuthorityReadBudget(),
    );
  const inputs = async () => {
    const rows = await db.operation.findMany({
      where: { kind: "acquire_movie_subtitles_v4", targetId: assetId },
      orderBy: { id: "asc" },
    });
    return rows.map((row) =>
      MovieSubtitleOperationV4Schema.parse(
        z.object(MovieSubtitleOperationV4Schema.shape).parse(row.payload),
      ),
    );
  };
  return { ...f, db, assetId, queue, work, inputs };
}

async function policy(
  f: { media: { id: string }; result: { subjectUserId: string } },
  input: {
    targets: z.infer<typeof SubtitlePolicyTargetSchema>[];
    edition?: MovieEditionKey;
    version?: number;
    epoch?: number;
  },
) {
  return h.database().mediaSubtitlePolicyVersion.create({
    data: {
      mediaId: f.media.id,
      actorId: f.result.subjectUserId,
      edition: input.edition ?? "default",
      version: input.version ?? 0,
      recoveryEpoch: input.epoch ?? 0,
      source: { fixture: true },
      rules: {
        schemaVersion: 1,
        protectedReasons: [],
        targets: input.targets,
      },
    },
  });
}

const forcedTarget = {
  sourceItemId: 1,
  language: "en" as const,
  audioLanguage: "en",
  forced: true,
  hearingImpaired: "required" as const,
  audio: "any" as const,
};

async function provider(
  f: Awaited<ReturnType<typeof fixture>>,
  input: {
    wrongCut?: boolean;
    beforeContent?: () => Promise<void>;
    beforeSearch?: () => Promise<void>;
  } = {},
) {
  const credential = await f.db.credential.create({
    data: {
      kind: "provider",
      ciphertext: h.cipher.encrypt(
        JSON.stringify({
          apiKey: "fixture",
          userAgent: "fixture",
          username: "fixture",
          password: "fixture",
        }),
        "provider:opensubtitles",
      ),
    },
  });
  await f.db.mediaProvider.upsert({
    where: { id: "opensubtitles" },
    create: { id: "opensubtitles", enabled: true, credentialId: credential.id },
    update: { enabled: true, credentialId: credential.id },
  });
  await f.db.providerLease.deleteMany({
    where: { providerId: "opensubtitles" },
  });
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.assetId },
  });
  const original = path
    .basename(z.string().parse(asset.sourcePath))
    .replace(/\.mkv$/u, "");
  const stem =
    input.wrongCut === true
      ? original.replace("Extended.Cut", "Theatrical.Cut")
      : original;
  if (stem === original && input.wrongCut === true)
    throw new Error("Wrong-cut provider fixture did not change its cut");
  if (!stem.endsWith(".ENG"))
    throw new Error(
      "Provider fixture lost its original release language suffix",
    );
  const filename = `${stem}.forced.sdh.srt`;
  const calls: URL[] = [];
  const transport: FetchTransport = async (url) => {
    calls.push(url);
    if (url.pathname.endsWith("/login"))
      return Response.json({ token: "fixture" });
    if (url.pathname.endsWith("/subtitles")) {
      await input.beforeSearch?.();
      return Response.json({
        total_pages: 1,
        data: [
          {
            id: "1",
            attributes: {
              language: "en",
              release: "human",
              ai_translated: false,
              machine_translated: false,
              foreign_parts_only: true,
              hearing_impaired: true,
              files: [{ file_id: 1, file_name: filename }],
            },
          },
        ],
      });
    }
    if (url.pathname.endsWith("/download"))
      return Response.json({
        link: "https://dl.opensubtitles.com/fixture.srt",
        file_name: filename,
      });
    if (url.hostname === "dl.opensubtitles.com") {
      await input.beforeContent?.();
      return new Response(
        "1\n00:00:00,000 --> 00:00:01,000\nSynthetic human caption fixture\n",
      );
    }
    throw new Error("Unexpected caption fixture endpoint");
  };
  return {
    calls,
    sources: {
      opensubtitles: (
        context: MediaAutomationContext,
        query: Parameters<typeof fromOpenSubtitles>[1],
      ) => fromOpenSubtitles(context, query, transport),
    },
  };
}

test("named editions inherit the movie policy until an explicit override, including an empty override", async () => {
  const f = await fixture();
  const household = await policy(f, { targets: [forcedTarget] });
  expect(await currentMovieSubtitlePolicies(f.db, f.input.scope)).toMatchObject(
    [{ id: household.id, edition: "default" }],
  );
  expect(await f.work()).toMatchObject({
    targets: expect.arrayContaining([
      { language: "en", forced: true, hearingImpaired: "required" },
    ]),
  });
  const override = await policy(f, { edition: "extended_cut", targets: [] });
  expect(await currentMovieSubtitlePolicies(f.db, f.input.scope)).toMatchObject(
    [{ id: override.id, edition: "extended_cut" }],
  );
  const work = await f.work();
  expect(work.targets).toEqual([
    { language: "en", hearingImpaired: "any" },
    { language: "zh-Hans", hearingImpaired: "any" },
  ]);
  await policy(f, {
    edition: "extended_cut",
    version: 1,
    epoch: 1,
    targets: [forcedTarget],
  });
  expect(await f.work()).toMatchObject({
    protectedReasons: ["subtitle_policy_epoch_unconfirmed"],
  });
});

test.each([false, true])(
  "provider captions require the imported cut and actual forced/SDH metadata (wrong cut: %s)",
  async (wrongCut) => {
    const f = await fixture();
    await policy(f, { targets: [forcedTarget] });
    await f.queue();
    const inputs = await f.inputs();
    const target = inputs.find((row) => row.forced === true);
    if (target === undefined) throw new Error("Forced policy target missing");
    const p = await provider(f, { wrongCut });
    const found = await findMovieSubtitlesV4(f.context, target, p.sources);
    if (wrongCut) {
      expect(found).toMatchObject({
        status: "waiting",
        reason: "matching_subtitles_not_found",
      });
      expect(p.calls.some((url) => url.pathname.endsWith("/download"))).toBe(
        false,
      );
      return;
    }
    expect(found.status).toBe("found");
    const input = {
      schemaVersion: 4 as const,
      operationId: target.operationId,
      scope: target.scope,
      assetId: f.assetId,
      subtitleId: z.uuid().parse(found.subtitleId),
    };
    await installMovieSubtitlesV4(f.files.context, input);
    expect(
      await readMovieSubtitleReceiptV4(
        f.db,
        input,
        new PublicationAuthorityReadBudget(),
      ),
    ).toMatchObject({
      after: {
        forced: true,
        hearingImpaired: true,
        path: expect.stringMatching(/\.en\.forced\.sdh\.srt$/u),
      },
    });
    const before = p.calls.length;
    expect(await findMovieSubtitlesV4(f.context, target, p.sources)).toEqual(
      found,
    );
    expect(p.calls).toHaveLength(before);
  },
);

test("a policy change during provider HTTP prevents persistence and installation", async () => {
  const f = await fixture();
  await policy(f, { targets: [forcedTarget] });
  await f.queue();
  const inputs = await f.inputs();
  const target = inputs.find((row) => row.forced === true);
  if (target === undefined) throw new Error("Forced policy target missing");
  const p = await provider(f, {
    beforeContent: async () => {
      await policy(f, { version: 1, targets: [] });
    },
  });
  expect(
    await findMovieSubtitlesV4(f.context, target, p.sources),
  ).toMatchObject({ status: "obsolete", reason: "subtitle_target_changed" });
  expect(
    await f.db.subtitleAsset.count({
      where: { assetId: f.assetId, providerId: "opensubtitles" },
    }),
  ).toBe(0);
  expect(
    p.calls.filter((url) => url.pathname.endsWith("/download")),
  ).toHaveLength(1);
  const count = p.calls.length;
  expect(
    await findMovieSubtitlesV4(f.context, target, p.sources),
  ).toMatchObject({ status: "obsolete" });
  expect(p.calls).toHaveLength(count);
});

test.each(["policy", "requester"] as const)(
  "%s changes during search cannot consume a provider download claim",
  async (change) => {
    const f = await fixture();
    await policy(f, { targets: [forcedTarget] });
    await f.queue();
    const inputs = await f.inputs();
    const target = inputs.find((row) => row.forced === true);
    if (target === undefined) throw new Error("Forced policy target missing");
    const expiresAt = Date.now() + 10_000;
    if (change === "requester")
      await f.db.plexIdentityMapping.update({
        where: { userId: f.result.subjectUserId },
        data: { verifiedAt: new Date(expiresAt - 300_000) },
      });
    const p = await provider(f, {
      beforeSearch: async () => {
        if (change === "policy") await policy(f, { version: 1, targets: [] });
        else {
          await f.db.plexIdentityMapping.update({
            where: { userId: f.result.subjectUserId },
            data: { verifiedAt: new Date() },
          });
          vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1);
        }
      },
    });
    const lookup = findMovieSubtitlesV4(f.context, target, p.sources);
    if (change === "policy")
      await expect(lookup).rejects.toMatchObject({
        reason: "subtitle_target_changed",
      });
    else
      await expect(lookup).rejects.toMatchObject({
        code: "movie_edition_choice_changed",
      });
    expect(p.calls.some((url) => url.pathname.endsWith("/download"))).toBe(
      false,
    );
    expect(
      await f.db.applicationEvent.count({
        where: {
          kind: "subtitle_download_requested",
          payload: { path: ["operationId"], equals: target.operationId },
        },
      }),
    ).toBe(0);
    expect(
      await f.db.subtitleAsset.count({
        where: { assetId: f.assetId, providerId: "opensubtitles" },
      }),
    ).toBe(0);
  },
);

test("real forced and SDH probe flags keep separate English tracks and satisfy policy-only extraction", async () => {
  const roles = [
    { forced: false, hearingImpaired: false },
    { forced: true, hearingImpaired: false },
    { forced: false, hearingImpaired: true },
  ];
  const clip = await movieVideoFixture(1920, roles);
  const f = await fixture({
    bytes: clip,
    beforeInspection: async (raw) => {
      await h.database().mediaRequest.update({
        where: { id: raw.result.requestId },
        data: { subtitleLanguages: [] },
      });
      await policy(raw, {
        targets: [
          ...roles.map((role, index) => ({
            ...forcedTarget,
            sourceItemId: index + 1,
            forced: role.forced,
            hearingImpaired: role.hearingImpaired
              ? ("required" as const)
              : ("excluded" as const),
          })),
          {
            ...forcedTarget,
            sourceItemId: 4,
            language: "zh-Hans",
            forced: false,
            hearingImpaired: "any",
          },
        ],
      });
    },
  });
  expect(await f.queue()).toBe(4);
  const paths = [];
  for (const target of await f.inputs()) {
    const found = await findMovieSubtitlesV4(f.context, target, {});
    expect(found.status).toBe("found");
    const input = {
      schemaVersion: 4 as const,
      operationId: target.operationId,
      scope: target.scope,
      assetId: f.assetId,
      subtitleId: z.uuid().parse(found.subtitleId),
    };
    await installMovieSubtitlesV4(f.files.context, input);
    const row = await f.db.subtitleAsset.findUniqueOrThrow({
      where: { id: input.subtitleId },
    });
    paths.push(row.path);
    expect(row).toMatchObject({
      forced: target.forced,
      hearingImpaired: target.hearingImpaired === "required",
    });
  }
  expect(new Set(paths).size).toBe(4);
  expect(subtitleTargetsReady(await f.work(), 0)).toBe(true);
});
