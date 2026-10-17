import { expect, test } from "vitest";
import { writeFile, rename, readFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inspectMedia, runMediaTool } from "#filesystem/media-tools.ts";
import { ContentProof } from "#filesystem/content-proof.ts";
import { nativeSubtitleSnapshot } from "./snapshot.ts";
import { captureNativeSubtitles, nativeSubtitleEvidence } from "./proof.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { nativeSubtitleHarness } from "./test-fixture.ts";

const harness = nativeSubtitleHarness();

test("trusted fixture mapping preserves canonical stored associations and real executor identities through final locks", async () => {
  const f = await harness.setup("accepted", true);
  const prepared = await f.prepare();
  expect(f.asset.path).toMatch(/^\/data\/movies\//u);
  expect(
    prepared.evidence.find((item) => item.storageKind === "sidecar"),
  ).toMatchObject({
    canonicalPath: f.sidecar.path,
    identity: {
      ancestors: expect.arrayContaining([
        expect.objectContaining({ path: f.roots.library }),
      ]),
    },
  });
  await f.apply(prepared);
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({ where: { id: f.sidecar.id } }),
  ).toMatchObject({ path: f.sidecar.path, ownershipEpoch: 1 });
});

test("actual ffprobe embedded stream evidence binds the original track and rejects changed stream metadata", async () => {
  const f = await harness.setup();
  const source = path.join(f.roots.downloads, "embedded-en.srt");
  await writeFile(source, f.text);
  const filename = path.join(f.roots.library, "real.mkv");
  await runMediaTool(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=16x16:d=1",
      "-i",
      source,
      "-map",
      "0:v",
      "-map",
      "1:s",
      "-c:v",
      "mpeg4",
      "-c:s",
      "srt",
      "-metadata:s:s:0",
      "language=eng",
      "-disposition:s:0",
      "0",
      filename,
    ],
    { timeoutMs: 30_000, maxBytes: 1024 },
  );
  const checksum = createHash("sha256")
    .update(await readFile(filename))
    .digest("hex");
  const file = {
    assetId: f.asset.id,
    assetVersion: 0,
    canonicalPath: filename,
    checksum,
    ownershipEpoch: 0,
    subtitles: [
      nativeSubtitleSnapshot({
        ...f.embedded,
        streamIndex: 1,
        videoChecksum: checksum,
      }),
    ],
  };
  const content = new ContentProof();
  await content.capture(filename, () => Promise.resolve());
  const captured = await captureNativeSubtitles({
    file,
    libraryRoot: f.roots.library,
    content,
    probe: await inspectMedia(filename),
    checkpoint: () => Promise.resolve(),
  });
  content.seal();
  expect(await nativeSubtitleEvidence(content, captured)).toMatchObject([
    {
      stream: {
        index: 1,
        codec: "subrip",
        language: "eng",
        forced: false,
        hearingImpaired: false,
      },
    },
  ]);
  const changed = path.join(f.roots.library, "changed.mkv");
  await runMediaTool(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-i",
      filename,
      "-map",
      "0",
      "-c",
      "copy",
      "-metadata:s:s:0",
      "language=fra",
      changed,
    ],
    { timeoutMs: 30_000, maxBytes: 1024 },
  );
  const changedContent = new ContentProof();
  await changedContent.capture(changed, () => Promise.resolve());
  await expect(
    captureNativeSubtitles({
      file: { ...file, canonicalPath: changed },
      libraryRoot: f.roots.library,
      content: changedContent,
      probe: await inspectMedia(changed),
      checkpoint: () => Promise.resolve(),
    }),
  ).rejects.toThrow("metadata changed");
});

test.each(["accepted", "unverified", "rejected"] as const)(
  "native same-video restore preserves %s quality and original evidence, including separate sidecar and embedded tracks",
  async (quality) => {
    const f = await harness.setup(quality);
    const prepared = await f.prepare();
    expect(prepared.evidence).toHaveLength(2);
    const bindings = await f.apply(prepared);
    expect(bindings).toHaveLength(2);
    const asset = await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
    });
    for (const before of [f.sidecar, f.embedded]) {
      const after = await f.db.subtitleAsset.findUniqueOrThrow({
        where: { id: before.id },
      });
      expect(after).toEqual({
        ...before,
        ownershipEpoch: 1,
        version: before.version + 1,
        videoVersion: asset.version,
      });
      expect(subtitleAccepted({ subtitle: after, asset, epoch: 1 })).toBe(
        quality === "accepted",
      );
    }
    for (const before of f.nonparticipants)
      expect(
        await f.db.subtitleAsset.findUniqueOrThrow({
          where: { id: before.id },
        }),
      ).toEqual(before);
    expect(
      await f.db.mediaIntent.findUniqueOrThrow({
        where: { mediaId: f.media.id },
      }),
    ).toMatchObject({ automationEpoch: 0 });
    expect(
      await f.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.publication.attempt.id },
      }),
    ).toMatchObject({ recoveryEpoch: 0 });
    expect(
      await f.db.recoveryHold.findUniqueOrThrow({
        where: { mediaId: f.media.id },
      }),
    ).toMatchObject({ recoveryEpoch: 1, releasedAt: null });
    expect(await readFile(f.sidecarPath, "utf8")).toBe(f.text);
  },
);

test.each([
  "bytes",
  "same_bytes_inode",
  "ancestor",
  "new_neighbor",
  "stored_evidence",
  "prior_epoch",
] as const)(
  "%s change protects native subtitles and rolls back the video ownership grant",
  async (change) => {
    const f = await harness.setup();
    const prepared = await f.prepare();
    if (change === "bytes") await writeFile(f.sidecarPath, "changed subtitle");
    if (change === "same_bytes_inode") {
      await rename(f.sidecarPath, f.sidecarPath + ".old");
      await writeFile(f.sidecarPath, f.text);
    }
    if (change === "ancestor") {
      const parent = path.dirname(f.asset.path),
        old = parent + "-old";
      await rename(parent, old);
      await mkdir(parent);
      await copyFile(path.join(old, path.basename(f.asset.path)), f.asset.path);
      await writeFile(f.sidecarPath, f.text);
    }
    if (change === "new_neighbor")
      await writeFile(
        f.asset.path.slice(0, -path.extname(f.asset.path).length) + ".fr.srt",
        "untracked",
      );
    if (change === "stored_evidence")
      await f.db.subtitleAsset.update({
        where: { id: f.sidecar.id },
        data: { matchingEvidence: { changed: true } },
      });
    if (change === "prior_epoch")
      await f.db.subtitleAsset.update({
        where: { id: f.sidecar.id },
        data: { ownershipEpoch: 2 },
      });
    await expect(f.apply(prepared)).rejects.toThrow();
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toMatchObject({ ownershipEpoch: 0, version: f.asset.version });
    expect(
      await f.db.subtitleAsset.findUniqueOrThrow({
        where: { id: f.embedded.id },
      }),
    ).toEqual(f.embedded);
  },
);

test.each(["codec", "language", "forced", "stream", "epoch"] as const)(
  "a stored/video %s mismatch cannot produce native subtitle proof",
  async (change) => {
    const f = await harness.setup();
    if (change === "epoch")
      await f.db.subtitleAsset.update({
        where: { id: f.sidecar.id },
        data: { ownershipEpoch: 2 },
      });
    const probe = {
      ...f.probe,
      streams: [
        {
          index: change === "stream" ? 3 : 2,
          codec_type: "subtitle" as const,
          codec_name: change === "codec" ? "ass" : "subrip",
          tags: { language: change === "language" ? "fra" : "eng" },
          disposition: {
            forced: change === "forced" ? (1 as const) : (0 as const),
            hearing_impaired: 0 as const,
          },
        },
      ],
    };
    await expect(f.prepare(probe)).rejects.toThrow(
      /binding|metadata|identity/u,
    );
  },
);

test("a different record at an installed subtitle path protects instead of silently taking ownership", async () => {
  const f = await harness.setup();
  await f.db.subtitleAsset.create({
    data: {
      assetId: f.asset.id,
      language: "en",
      providerId: "collision",
      path: f.sidecarPath,
      state: "failed",
      qualityStatus: "rejected",
      provenance: {},
      matchingEvidence: {},
    },
  });
  await expect(f.prepare()).rejects.toThrow("storage collision");
});
