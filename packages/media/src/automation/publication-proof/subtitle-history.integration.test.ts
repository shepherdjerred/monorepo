import { expect, test } from "vitest";
import { replacementHarness } from "#automation/subtitle-replacement/test-fixture.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { PublicationIntentSchema } from "#shared/publication-proof/intent.ts";
import { PublicationOutcomeSchema } from "#shared/publication-proof/outcome.ts";
import { publicationArchiveSnapshot } from "#infrastructure/publication-proof/projection.ts";

const harness = replacementHarness();

test.each(["installed", "abandoned"] as const)(
  "actual %s subtitle replacement history survives a later video publication without becoming a physical participant",
  async (settlement) => {
    const f = await harness.setup();
    if (settlement === "installed")
      expect(
        await f.activities().applySubtitleReplacement(await f.approve()),
      ).toEqual({ state: "applied" });
    else {
      expect(
        await f.activities().prepareSubtitleReplacement(f.prepareInput),
      ).toEqual({ state: "ready" });
      expect(await f.reconcile()).toEqual({ state: "rolled_back" });
    }
    const historyId = settlement === "installed" ? f.old.id : f.candidateId;
    const history = await f.db.subtitleAsset.findUniqueOrThrow({
      where: { id: historyId },
    });
    const replacement = await f.row();
    expect(replacement.receipt?.outcome).toBe(settlement);
    await f.db.acquisitionAttempt.updateMany({
      where: { mediaIds: { has: f.media.id } },
      data: { state: "completed" },
    });
    const inspect = f.context.inspect;
    if (inspect === undefined) throw new Error("Fixture probe missing");
    f.context.inspect = async (filename) => {
      const probe = await inspect(filename);
      return {
        ...probe,
        streams: probe.streams.map((stream) =>
          stream.codec_type === "video"
            ? { ...stream, width: 3840, height: 1600 }
            : stream,
        ),
      };
    };
    const acquisition = await f.acquisition(
      "Video upgrade after settled replacement history",
    );
    const files = createMediaFileActivities(f.context);
    expect(await files.inspectAndStageMedia(acquisition.input)).toEqual({
      status: "staged",
    });
    expect(await files.promoteMediaFiles(acquisition.input)).toEqual({
      status: "published",
    });
    const transition = await f.db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: acquisition.attempt.id },
    });
    const intent = PublicationIntentSchema.parse(transition.intent);
    const outcome = PublicationOutcomeSchema.parse(transition.outcome);
    const before = intent.entries[0]?.predecessor;
    const after = outcome.entries[0]?.predecessor;
    if (before == null || after == null)
      throw new Error("Actual predecessor outcome missing");
    expect(before.subtitleHistory.map((item) => item.id)).toContain(historyId);
    expect(before.subtitles.map((item) => item.id)).not.toContain(historyId);
    expect(
      publicationArchiveSnapshot(after, "movies").subtitles.map(
        (item) => item.id,
      ),
    ).not.toContain(historyId);
    expect(
      await f.db.subtitleAsset.findUniqueOrThrow({ where: { id: historyId } }),
    ).toEqual(history);
  },
);
