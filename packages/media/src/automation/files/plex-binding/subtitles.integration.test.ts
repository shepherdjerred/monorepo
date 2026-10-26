import { expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  targetHarness,
  subtitleTransport,
} from "#automation/subtitles/target-fixture.ts";
import { createSubtitleActivities } from "#automation/subtitles.ts";
import { fromOpenSubtitles } from "#automation/subtitle-sources.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";

const harness = targetHarness();

test("owned caption installation and its exact replay do not require a serving Plex binding", async () => {
  const f = await harness.setup();
  expect(
    await f.db.plexBindingCurrent.count({ where: { mediaId: f.media.id } }),
  ).toBe(0);
  const access = vi.fn(() =>
    Promise.reject(
      new Error(
        "Prepublication installation must not resolve serving Plex access",
      ),
    ),
  );
  f.context.plexAccess = access;
  await f.queue();
  const inputs = await f.inputs();
  const [input] = inputs;
  if (input === undefined)
    throw new Error("Actual subtitle producer did not queue a target");
  const provider = subtitleTransport();
  const found = await createSubtitleActivities(f.network, {
    opensubtitles: (context, request) =>
      fromOpenSubtitles(context, request, provider.transport),
  }).findMediaSubtitles(input);
  expect(found.status).toBe("found");
  const command = {
    operationId: input.operationId,
    subtitleId: z.uuid().parse(found.subtitleId),
  };
  const files = createMediaFileActivities(f.context);
  expect(await files.installMediaSubtitles(command)).toEqual({
    status: "installed",
  });
  const installed = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: command.subtitleId },
  });
  expect(await readFile(z.string().parse(installed.path), "utf8")).toContain(
    "Caption",
  );
  expect(await files.installMediaSubtitles(command)).toEqual({
    status: "installed",
  });
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({ where: { id: installed.id } }),
  ).toEqual(installed);
  expect(access).not.toHaveBeenCalled();
  expect(
    await f.db.plexBindingCurrent.count({ where: { mediaId: f.media.id } }),
  ).toBe(0);
});
