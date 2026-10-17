import path from "node:path";
import { rm } from "node:fs/promises";
import { expect, test } from "vitest";
import { z } from "zod";
import {
  targetHarness,
  subtitleTransport,
} from "#automation/subtitles/target-fixture.ts";
import { createSubtitleActivities } from "#automation/subtitles.ts";
import { fromOpenSubtitles } from "#automation/subtitle-sources.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { nativeSubtitleSnapshot } from "#automation/native-subtitles/snapshot.ts";
import { inspectHandoffJournals } from "#automation/handoff/journals.ts";
import { verifyInstallationJournal } from "#automation/native-recovery/terminal-proof.ts";
import { settledInstalledSubtitle } from "./installed-subtitles.ts";

const harness = targetHarness();
test("actual provider install proves the exact additional caption via its UUID source journal", async () => {
  const f = await harness.setup();
  await f.queue();
  const inputs = await f.inputs();
  const input = inputs.find((item) => item.forced);
  if (input === undefined) throw new Error("Forced fixture input missing");
  const provider = subtitleTransport();
  const found = await createSubtitleActivities(f.network, {
    opensubtitles: (context, search) =>
      fromOpenSubtitles(context, search, provider.transport),
  }).findMediaSubtitles(input);
  const subtitleId = z.uuid().parse(found.subtitleId);
  expect(
    await createMediaFileActivities(f.context).installMediaSubtitles({
      operationId: input.operationId,
      subtitleId,
    }),
  ).toEqual({ status: "installed" });
  const subtitle = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: subtitleId },
  });
  const canonical = (name: string) =>
    path.join("/data/movies", path.relative(f.roots.library, name));
  const evidence = await f.db.$transaction((tx) =>
    settledInstalledSubtitle(tx, {
      subtitle: {
        ...nativeSubtitleSnapshot(subtitle),
        path: canonical(z.string().parse(subtitle.path)),
      },
      chain: [],
      video: {
        path: canonical(f.asset.path),
        checksum: z.string().parse(f.asset.checksum),
        mediaIds: [f.media.id],
        libraryKind: "movies",
      },
      videoBindings: [{ version: f.asset.version, epoch: 0 }],
    }),
  );
  const readProof = async () => ({
    journals: [
      await inspectHandoffJournals(
        f.roots.control,
        new Set([z.string().parse(subtitle.path)]),
      ),
    ],
    resolvePath: (name: string) =>
      name.startsWith("/data/movies/.media-control/")
        ? path.join(
            f.roots.control,
            path.relative("/data/movies/.media-control", name),
          )
        : path.join(f.roots.library, path.relative("/data/movies", name)),
  });
  expect(
    await verifyInstallationJournal(
      await readProof(),
      evidence.installation.journals,
    ),
  ).toMatchObject({ operationId: input.operationId });
  await rm(path.join(f.roots.control, "journal", `${input.operationId}.json`));
  await expect(
    verifyInstallationJournal(
      await readProof(),
      evidence.installation.journals,
    ),
  ).rejects.toThrow("one exact installation journal");
});
