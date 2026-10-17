import { afterAll } from "vitest";
import { createHash } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";
import { ContentProof } from "#filesystem/content-proof.ts";
import { FileOperations } from "#filesystem/operations.ts";
import type { MediaProbe } from "#filesystem/media-tools.ts";
import { snapshotNativeSubtitles, lockNativeSubtitleRows } from "./snapshot.ts";
import {
  captureNativeSubtitles,
  nativeSubtitleEvidence,
  type NativeSubtitleFile,
} from "./proof.ts";
import { rebindNativeSubtitles } from "./apply.ts";

export function nativeSubtitleHarness() {
  const harness = automationTestHarness();
  const directories: string[] = [];
  afterAll(async () => {
    for (const directory of directories)
      await rm(directory, { recursive: true, force: true });
  });
  async function setup(
    qualityStatus: "accepted" | "unverified" | "rejected" = "accepted",
    mapped = false,
  ) {
    const db = harness.database();
    const f = await fileFixture(db);
    directories.push(f.directory);
    const publication = await f.published();
    const originalAsset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: publication.entry.assetId },
    });
    const localVideoPath = originalAsset.path;
    const asset = mapped
      ? await db.libraryAsset.update({
          where: { id: originalAsset.id },
          data: {
            path: path.join(
              "/data/movies",
              path.relative(f.roots.library, localVideoPath),
            ),
          },
        })
      : originalAsset;
    const resolvePath = (canonicalPath: string) =>
      mapped
        ? path.join(
            f.roots.library,
            path.relative("/data/movies", canonicalPath),
          )
        : canonicalPath;
    const sidecarPath =
      localVideoPath.slice(0, -path.extname(localVideoPath).length) + ".en.srt";
    const canonicalSidecarPath =
      asset.path.slice(0, -path.extname(asset.path).length) + ".en.srt";
    const text =
      "1\n00:00:01,000 --> 00:00:02,000\nPreserved fixture caption\n";
    await writeFile(sidecarPath, text);
    const checksum = createHash("sha256").update(text).digest("hex");
    const common = {
      assetId: asset.id,
      language: "en",
      providerId: "fixture",
      state: "installed",
      qualityStatus,
      ownershipEpoch: 0,
      videoChecksum: asset.checksum,
      videoVersion: asset.version,
      forced: false,
      hearingImpaired: false,
      provenance: { original: "retained" },
      matchingEvidence: { original: "retained" },
    };
    const sidecar = await db.subtitleAsset.create({
      data: {
        ...common,
        storageKind: "sidecar",
        path: canonicalSidecarPath,
        checksum,
        content: Buffer.from(text),
      },
    });
    const embedded = await db.subtitleAsset.create({
      data: {
        ...common,
        storageKind: "embedded",
        streamIndex: 2,
        codec: "subrip",
      },
    });
    const nonparticipants = [];
    for (const state of ["validated", "failed", "purged"])
      nonparticipants.push(
        await db.subtitleAsset.create({
          data: { ...common, state, storageKind: "sidecar", checksum },
        }),
      );
    await prepareMediaRestore(db, {
      recoveryId: crypto.randomUUID(),
      expectedEpoch: 0,
      reason: "Native subtitle fixture restore",
    });
    const probe: MediaProbe = {
      streams: [
        {
          index: 2,
          codec_type: "subtitle",
          codec_name: "subrip",
          tags: { language: "eng" },
          disposition: { forced: 0, hearing_impaired: 0 },
        },
      ],
      format: {
        duration: "2",
        size: String(asset.sizeBytes),
        format_name: "matroska",
      },
    };
    async function prepare(overrideProbe = probe) {
      const subtitles = await snapshotNativeSubtitles(db, asset.id);
      const file: NativeSubtitleFile = {
        assetId: asset.id,
        assetVersion: asset.version,
        canonicalPath: asset.path,
        checksum: publication.entry.checksum,
        ownershipEpoch: asset.ownershipEpoch,
        subtitles,
      };
      const content = new ContentProof();
      await content.capture(localVideoPath, () => Promise.resolve());
      const captured = await captureNativeSubtitles({
        file,
        libraryRoot: f.roots.library,
        content,
        probe: overrideProbe,
        checkpoint: () => Promise.resolve(),
        resolvePath,
      });
      content.seal();
      return {
        file,
        content,
        evidence: await nativeSubtitleEvidence(content, captured),
      };
    }
    async function apply(prepared: Awaited<ReturnType<typeof prepare>>) {
      const operations = new FileOperations(f.roots, {
        authorize: () => Promise.reject(new Error("Read-only fixture proof")),
      });
      const targets = [localVideoPath, sidecarPath].sort();
      const withLocks = async <T>(
        index: number,
        action: () => Promise<T>,
      ): Promise<T> => {
        const target = targets[index];
        if (target === undefined) return action();
        const identity = await prepared.content.verifiedFile(target);
        return operations.withFileIdentity(
          { ...identity, libraryPath: path.relative(f.roots.library, target) },
          () => withLocks(index + 1, action),
        );
      };
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id='singleton' FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id=${asset.id} FOR UPDATE`;
        await lockNativeSubtitleRows(tx, [asset.id]);
        return withLocks(0, async () => {
          await tx.libraryAsset.update({
            where: { id: asset.id },
            data: { version: { increment: 1 }, ownershipEpoch: 1 },
          });
          return rebindNativeSubtitles(tx, {
            ...prepared,
            resolvePath,
            newAssetVersion: asset.version + 1,
            epoch: 1,
          });
        });
      });
    }
    return {
      ...f,
      db,
      asset,
      publication,
      sidecar,
      embedded,
      sidecarPath,
      localVideoPath,
      resolvePath,
      text,
      nonparticipants,
      probe,
      prepare,
      apply,
    };
  }
  return { ...harness, setup };
}
