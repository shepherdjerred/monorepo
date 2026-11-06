/** Verifies actual extraction and installation through current household caption work. */
import { readFile } from "node:fs/promises";
import { expect } from "vitest";
import { z } from "zod";
import { createHash } from "node:crypto";
import { FilePlanSchema } from "#automation/files/types.ts";
import { queueCurrentSubtitleTargets } from "#automation/subtitles/queue.ts";
import {
  SubtitleWorkSchema,
  currentSubtitleWork,
  subtitleTargetsReady,
} from "#automation/subtitles/authority.ts";
import { createSubtitleActivities } from "#automation/subtitles.ts";
import { validateSubtitle } from "#integrations/subtitle-validation.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import type { createPerEpisodeMultiSeasonFixture } from "#testing/series-workflow/per-episode/fixture.ts";
import type { Operation } from "#generated/prisma/client.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

type Fixture = Pick<
  Awaited<ReturnType<typeof createPerEpisodeMultiSeasonFixture>>,
  "db" | "ids" | "series" | "context" | "files" | "physical"
>;
type ExistingTargets = {
  targets: "already_queued";
  commands: readonly { operationId: string; payloadHash: string }[];
};

export async function assertAndInstallActualCaptions(
  f: Fixture,
  attemptId: string,
  expectedMembers = 24,
  existing?: ExistingTargets,
) {
  const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  const plan = FilePlanSchema.parse(attempt.filePlan);
  expect(plan).toHaveLength(expectedMembers);
  if (expectedMembers === 24)
    expect(plan.every((entry) => entry.mediaIds.length === 1)).toBe(true);
  expect(new Set(plan.flatMap((entry) => entry.mediaIds))).toEqual(
    new Set(f.ids),
  );
  expect(new Set(plan.map((entry) => entry.assetId)).size).toBe(
    expectedMembers,
  );
  for (const entry of plan) {
    expect(entry.embeddedSubtitles).toHaveLength(2);
    expect(
      entry.embeddedSubtitles.map((subtitle) => subtitle.language).toSorted(),
    ).toEqual(["en", "zh-Hans"]);
  }
  const extracted = await f.db.subtitleAsset.findMany({
    where: { assetId: { in: plan.map((entry) => entry.assetId) } },
  });
  expect(extracted).toHaveLength(expectedMembers * 2);
  for (const subtitle of extracted) {
    expect(subtitle).toMatchObject({
      state: "validated",
      qualityStatus: "accepted",
      providerId: "embedded",
      storageKind: "sidecar",
      path: null,
    });
    const content = z.instanceof(Uint8Array).parse(subtitle.content);
    expect(createHash("sha256").update(content).digest("hex")).toBe(
      subtitle.checksum,
    );
    const valid = validateSubtitle({
      bytes: content,
      filename: "embedded.srt",
      requireSimplified: subtitle.language === "zh-Hans",
      provenanceText: "Actual native fixture embedded text",
    });
    expect(valid.text.length).toBeGreaterThan(0);
  }
  // Use the actual current-policy producer. It creates actual target Operations;
  // no synthetic operation IDs or direct policy/AA/outbox/receipt inserts.
  for (const entry of plan)
    expect(
      await f.db.$transaction((tx) =>
        queueCurrentSubtitleTargets(tx, {
          assetId: entry.assetId,
          epoch: attempt.recoveryEpoch,
        }),
      ),
    ).toBe(existing?.targets === "already_queued" ? 0 : 2);
  let providerCalls = 0;
  const subtitles = createSubtitleActivities(f.context, {
    opensubtitles: () => {
      providerCalls++;
      return Promise.resolve(null);
    },
  });
  const operations = await f.db.operation.findMany({
    where: {
      kind: "acquire_subtitles",
      targetId: { in: plan.map((entry) => entry.assetId) },
    },
    orderBy: { id: "asc" },
  });
  expect(operations).toHaveLength(expectedMembers * 2);
  assertExistingCommands(operations, existing, expectedMembers * 2);
  for (const operation of operations) {
    const input = SubtitleWorkSchema.extend({
      operationId: z.uuid(),
      assetId: z.uuid(),
    }).parse(operation.payload);
    const found = await subtitles.findMediaSubtitles({
      operationId: input.operationId,
      assetId: input.assetId,
      language: input.language,
      ...(input.forced === undefined ? {} : { forced: input.forced }),
      ...(input.hearingImpaired === undefined
        ? {}
        : { hearingImpaired: input.hearingImpaired }),
      ...(input.targetAuthority === undefined
        ? {}
        : { targetAuthority: input.targetAuthority }),
    });
    expect(found.status).toBe("found");
    const subtitleId = z.uuid().parse(found.subtitleId);
    expect(
      await f.physical.installMediaSubtitles({
        operationId: operation.id,
        subtitleId,
      }),
    ).toEqual({ status: "installed" });
    const installed = await f.db.subtitleAsset.findUniqueOrThrow({
      where: { id: subtitleId },
    });
    expect(installed).toMatchObject({
      state: "installed",
      qualityStatus: "accepted",
      storageKind: "sidecar",
    });
    const stored = await readFile(
      workerFilePath(f.files, z.string().parse(installed.path)),
    );
    expect(stored).toEqual(
      Buffer.from(z.instanceof(Uint8Array).parse(installed.content)),
    );
    expect(createHash("sha256").update(stored).digest("hex")).toBe(
      installed.checksum,
    );
  }
  expect(providerCalls).toBe(0);
  for (const entry of plan) {
    const current = await currentSubtitleWork(
      f.db,
      entry.assetId,
      attempt.recoveryEpoch,
    );
    expect(subtitleTargetsReady(current, attempt.recoveryEpoch)).toBe(true);
  }
  expect(
    await f.db.mediaRequest.count({
      where: { mediaId: { in: [f.series.id, ...f.ids] } },
    }),
  ).toBe(0);
}

function assertExistingCommands(
  operations: readonly Operation[],
  expected: ExistingTargets | undefined,
  count: number,
) {
  if (expected === undefined) return;
  expect(expected.commands).toHaveLength(count);
  expect(new Set(operations.map((operation) => operation.id))).toEqual(
    new Set(expected.commands.map((command) => command.operationId)),
  );
  const hashes = new Map(
    expected.commands.map((command) => [
      command.operationId,
      command.payloadHash,
    ]),
  );
  for (const operation of operations)
    expect(identityHash(operation.payload)).toBe(hashes.get(operation.id));
}
