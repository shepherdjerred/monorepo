import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { PrismaAdminApplication } from "#infrastructure/admin-service.ts";
import { rm } from "node:fs/promises";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import {
  nativeCompensationFixture,
  testCompensationExecution,
} from "#automation/native-compensation/test-fixture.ts";
import { reconcileCompensationHousehold } from "#automation/native-compensation/fixtures/household.ts";
import { compensationPublicationContext } from "#automation/native-compensation/fixtures/publication.ts";
import { publishCompensatedMedia } from "#automation/native-compensation/publication.ts";

export async function compensatedCaptionFixture(
  db: Database,
  network: MediaAutomationContext,
  options: Parameters<typeof nativeCompensationFixture>[2] = {},
) {
  const f = await nativeCompensationFixture(db, network.cipher, options);
  try {
    await f.prepare();
    const input = await f.apply();
    await f.observe(input);
    const completed =
      await f.activities.compensateNativePublicationFiles(input);
    if (completed.status !== "compensated")
      throw new Error(
        `Actual compensation protected: ${String(completed.reason)}`,
      );
    await reconcileCompensationHousehold(db, {
      owner: f.prior.actor,
      requester: f.file.user,
      mediaIds: f.published.entry.mediaIds,
      kind: "movie",
      serverMachineId: "server",
    });
    const continuation =
      await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: input.continuationId },
      });
    const published = await publishCompensatedMedia(
      compensationPublicationContext(network, f.observerContext, {
        requests: [],
      }),
      {
        ...input,
        operationId: z
          .uuid()
          .parse(continuation.publicationCoordinatorOperationId),
      },
      testCompensationExecution(),
    );
    if (published.status !== "available")
      throw new Error(
        `Actual compensation publication failed: ${String(published.reason)}`,
      );
    f.file.context.serverMachineId = "server";
    const installed = await installCompensationFixtureCaption(db, network, f, {
      assetId: f.asset.id,
    });
    return { f, input, ...installed, completion: continuation.completion };
  } catch (error) {
    await rm(f.file.directory, { recursive: true, force: true });
    throw error;
  }
}

export async function installCompensationFixtureCaption(
  db: Database,
  network: MediaAutomationContext,
  f: Awaited<ReturnType<typeof nativeCompensationFixture>>,
  options: { assetId: string; language?: "en" | "zh-Hans" },
) {
  const { assetId, language = "en" } = options;
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: assetId },
  });
  const uploaded = await new PrismaAdminApplication(
    db,
    network.cipher,
  ).uploadSubtitle(f.prior.actor, crypto.randomUUID(), {
    assetId: asset.id,
    expectedAssetVersion: asset.version,
    expectedChecksum: z.string().parse(asset.checksum),
    language,
    filename: "additional.srt",
    description: "Owner verified forced English captions",
    contentBase64: Buffer.from(
      language === "zh-Hans"
        ? "1\n00:00:00,000 --> 00:00:01,000\n这是经过人工校对的简体中文字幕，请认真观看。\n"
        : "1\n00:00:00,000 --> 00:00:01,000\nNew forced English caption\n",
    ).toString("base64"),
    declaredEncoding: "utf8",
    confirmedMatchingVideo: true,
    forced: true,
    hearingImpaired: false,
  });
  const operationId = z.uuid().parse(uploaded.operationId);
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  const { subtitleId } = z
    .object({ subtitleId: z.uuid() })
    .parse(operation.payload);
  await createMediaFileActivities(f.file.context).installMediaSubtitles({
    subtitleId,
    operationId,
  });
  const subtitle = await db.subtitleAsset.findUniqueOrThrow({
    where: { id: subtitleId },
  });
  if (subtitle.state !== "installed")
    throw new Error("Actual additional caption was not installed");
  return { subtitle, operation };
}
