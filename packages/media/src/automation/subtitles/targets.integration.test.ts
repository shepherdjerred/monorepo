import { expect, test, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { createHash } from "node:crypto";
import { createSubtitleActivities } from "#automation/subtitles.ts";
import { fromOpenSubtitles, fromAssrt } from "#automation/subtitle-sources.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { currentSubtitleWork, subtitleTargetsReady } from "./authority.ts";
import { targetHarness, subtitleTransport } from "./target-fixture.ts";

const harness = targetHarness();

test("actual target queue dispatches distinct regular and forced inputs, validates provider evidence and installs both before readiness", async () => {
  const f = await harness.setup();
  expect(await f.queue()).toBe(2);
  expect(await f.queue()).toBe(0);
  const inputs = await f.inputs();
  expect(inputs).toHaveLength(2);
  expect(new Set(inputs.map((input) => input.operationId)).size).toBe(2);
  const start = vi.fn(() => Promise.resolve());
  await createOutboxActivities(f.db, start).dispatchMediaOutbox();
  for (const input of inputs)
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowType: "acquireMediaSubtitlesWorkflow",
        workflowId: `media-operation-${input.operationId}`,
        input: expect.objectContaining(input),
      }),
    );
  const provider = subtitleTransport();
  const network = createSubtitleActivities(f.network, {
    opensubtitles: (context, input) =>
      fromOpenSubtitles(context, input, provider.transport),
  });
  const files = createMediaFileActivities(f.context);
  const paths: string[] = [];
  for (const [index, input] of inputs.entries()) {
    await f.db.providerLease.updateMany({
      where: { providerId: "opensubtitles" },
      data: { nextAllowedAt: new Date(0) },
    });
    const found = await network.findMediaSubtitles(input);
    expect(found.status).toBe("found");
    expect(await network.findMediaSubtitles(input)).toEqual(found);
    const subtitleId = found.subtitleId ?? "missing";
    expect(
      await files.installMediaSubtitles({
        operationId: input.operationId,
        subtitleId,
      }),
    ).toEqual({ status: "installed" });
    const row = await f.db.subtitleAsset.findUniqueOrThrow({
      where: { id: subtitleId },
    });
    expect(row).toMatchObject({
      forced: input.forced,
      hearingImpaired: false,
      state: "installed",
      qualityStatus: "accepted",
    });
    paths.push(row.path ?? "missing");
    expect(await readFile(row.path ?? "missing", "utf8")).toContain("Caption");
    expect(
      subtitleTargetsReady(await currentSubtitleWork(f.db, f.asset.id, 0), 0),
    ).toBe(index === 1);
    expect(
      await f.db.notificationDelivery.count({
        where: { userId: f.user.id, event: { kind: "subtitles_ready" } },
      }),
    ).toBe(index === 1 ? 1 : 0);
  }
  expect(new Set(paths).size).toBe(2);
  expect(paths.some((path) => path.endsWith(".en.forced.srt"))).toBe(true);
  expect(paths.some((path) => path.endsWith(".en.srt"))).toBe(true);
  expect(
    provider.calls.filter((call) => call.path.endsWith("/download")),
  ).toHaveLength(2);
  expect(
    provider.calls
      .filter((call) => call.path.endsWith("/subtitles"))
      .map((call) => [
        call.query.get("foreign_parts_only"),
        call.query.get("hearing_impaired"),
      ]),
  ).toEqual(
    expect.arrayContaining([
      ["only", "exclude"],
      ["exclude", "include"],
    ]),
  );
  expect(await f.queue()).toBe(0);
});

test.each(["wrong", "unknown"] as const)(
  "%s provider metadata never consumes a download or satisfies forced target",
  async (metadata) => {
    const f = await harness.setup();
    await f.queue();
    const inputs = await f.inputs();
    const input = inputs.find((item) => item.forced);
    if (input === undefined) throw new Error("No forced target");
    const provider = subtitleTransport(metadata);
    const result = await createSubtitleActivities(f.network, {
      opensubtitles: (context, search) =>
        fromOpenSubtitles(context, search, provider.transport),
    }).findMediaSubtitles(input);
    expect(result).toMatchObject({
      status: "waiting",
      reason: "matching_subtitles_not_found",
    });
    expect(provider.calls.some((call) => call.path.endsWith("/download"))).toBe(
      false,
    );
    expect(
      await f.db.subtitleAsset.count({ where: { assetId: f.asset.id } }),
    ).toBe(0);
  },
);

test("a provider without proven target metadata declines before credentials or downloads", async () => {
  const f = await harness.setup();
  await expect(
    fromAssrt(f.network, {
      operationId: crypto.randomUUID(),
      query: "Fixture",
      sourceFilename: "Fixture.mkv",
      language: "zh-Hans",
      forced: true,
      hearingImpaired: "excluded",
    }),
  ).rejects.toMatchObject({ kind: "unsupported-target" });
});

test("an owned unverified normal sidecar requires visible replacement review and remains unchanged", async () => {
  const f = await harness.setup();
  await f.queue();
  const inputs = await f.inputs();
  const input = inputs.find((item) => !item.forced);
  if (input === undefined) throw new Error("No normal target");
  const path =
    f.asset.path.slice(0, -nodePath.extname(f.asset.path).length) + ".en.srt";
  const bytes = "1\n00:00:01,000 --> 00:00:02,000\nUnverified old subtitle\n";
  await writeFile(path, bytes);
  await f.db.subtitleAsset.create({
    data: {
      assetId: f.asset.id,
      language: "en",
      providerId: "migration",
      state: "installed",
      qualityStatus: "unverified",
      storageKind: "sidecar",
      ownershipEpoch: 0,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      videoChecksum: f.asset.checksum,
      videoVersion: f.asset.version,
      forced: false,
      hearingImpaired: false,
      path,
      provenance: {},
      matchingEvidence: {},
    },
  });
  const provider = subtitleTransport();
  const found = await createSubtitleActivities(f.network, {
    opensubtitles: (context, search) =>
      fromOpenSubtitles(context, search, provider.transport),
  }).findMediaSubtitles(input);
  expect(found.status).toBe("found");
  expect(
    await createMediaFileActivities(f.context).installMediaSubtitles({
      operationId: input.operationId,
      subtitleId: found.subtitleId ?? "missing",
    }),
  ).toEqual({
    status: "blocked",
    reason: "subtitle_path_requires_owner_review",
  });
  expect(await readFile(path, "utf8")).toBe(bytes);
  expect(
    subtitleTargetsReady(await currentSubtitleWork(f.db, f.asset.id, 0), 0),
  ).toBe(false);
});

test("an identical unverified sidecar keeps its ownership and quality until explicit review", async () => {
  const f = await harness.setup();
  await f.queue();
  const inputs = await f.inputs();
  const input = inputs.find((item) => !item.forced);
  if (input === undefined) throw new Error("No normal target");
  const provider = subtitleTransport();
  const found = await createSubtitleActivities(f.network, {
    opensubtitles: (context, search) =>
      fromOpenSubtitles(context, search, provider.transport),
  }).findMediaSubtitles(input);
  expect(found.status).toBe("found");
  const candidate = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: found.subtitleId ?? "missing" },
  });
  const path =
    f.asset.path.slice(0, -nodePath.extname(f.asset.path).length) + ".en.srt";
  const content = Buffer.from(candidate.content ?? []);
  await writeFile(path, content, { flag: "wx" });
  const original = await f.db.subtitleAsset.create({
    data: {
      assetId: f.asset.id,
      language: "en",
      providerId: "migration",
      state: "installed",
      qualityStatus: "unverified",
      storageKind: "sidecar",
      ownershipEpoch: 0,
      checksum: candidate.checksum,
      videoChecksum: f.asset.checksum,
      videoVersion: f.asset.version,
      forced: false,
      hearingImpaired: false,
      path,
      provenance: {},
      matchingEvidence: {},
    },
  });
  expect(
    await createMediaFileActivities(f.context).installMediaSubtitles({
      operationId: input.operationId,
      subtitleId: candidate.id,
    }),
  ).toEqual({
    status: "blocked",
    reason: "subtitle_path_requires_owner_review",
  });
  expect(await readFile(path)).toEqual(content);
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({ where: { id: original.id } }),
  ).toEqual(original);
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({ where: { id: candidate.id } }),
  ).toEqual(candidate);
});
