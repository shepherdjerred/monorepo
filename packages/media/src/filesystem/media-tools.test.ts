import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  inspectMedia,
  extractEmbeddedSubtitle,
  runMediaTool,
  type RunMediaTool,
} from "./media-tools.ts";
import {
  extractSubtitleArchive,
  parseArchiveListing,
} from "./subtitle-archive.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const archiveBytes = Buffer.from(
  "UEsDBBQAAAAAAAAAIVDtso49JAAAACQAAAASAAAARml4dHVyZS5TMDFFMDEuc3J0MQowMDowMDowMSwwMDAgLS0+IDAwOjAwOjAyLDAwMApPbmUKUEsDBBQAAAAAAAAAIVAGEo5TJAAAACQAAAASAAAARml4dHVyZS5TMDFFMDIuc3J0MQowMDowMDowMSwwMDAgLS0+IDAwOjAwOjAyLDAwMApUd28KUEsBAhQDFAAAAAAAAAAhUO2yjj0kAAAAJAAAABIAAAAAAAAAAAAAAIABAAAAAEZpeHR1cmUuUzAxRTAxLnNydFBLAQIUAxQAAAAAAAAAIVAGEo5TJAAAACQAAAASAAAAAAAAAAAAAACAAVQAAABGaXh0dXJlLlMwMUUwMi5zcnRQSwUGAAAAAAIAAgCAAAAAqAAAAAAA",
  "base64",
);
const traversalBytes = Buffer.from(
  "UEsDBBQAAAAAAAAAIVD7OSuCAwAAAAMAAAANAAAALi4vZXNjYXBlLnNydGJhZFBLAQIUAxQAAAAAAAAAIVD7OSuCAwAAAAMAAAANAAAAAAAAAAAAAACAAQAAAAAuLi9lc2NhcGUuc3J0UEsFBgAAAAABAAEAOwAAAC4AAAAAAA==",
  "base64",
);

describe("media inspection", () => {
  it("validates actual video streams and disallows network protocols", async () => {
    const run: RunMediaTool = async (tool, args) => {
      expect(tool).toBe("ffprobe");
      expect(args).toContain("file,pipe");
      return new TextEncoder().encode(
        JSON.stringify({
          format: {
            size: "1000",
            duration: "12.5",
            format_name: "matroska,webm",
          },
          streams: [
            {
              index: 0,
              codec_type: "video",
              codec_name: "h264",
              width: 1920,
              height: 1080,
            },
          ],
        }),
      );
    };
    const media = await inspectMedia("/fixture/video.mkv", { run });
    expect(media.streams[0]?.height).toBe(1080);
  });
  it("extracts only an explicitly mapped text subtitle stream", async () => {
    const run: RunMediaTool = async (tool, args) => {
      expect(tool).toBe("ffmpeg");
      expect(args).toContain("0:3");
      return new TextEncoder().encode("subtitle");
    };
    await expect(
      extractEmbeddedSubtitle(
        { path: "/fixture/video.mkv", streamIndex: 3, codec: "ass" },
        { run },
      ),
    ).resolves.toMatchObject({ format: "ass" });
    await expect(
      extractEmbeddedSubtitle(
        {
          path: "/fixture/video.mkv",
          streamIndex: 3,
          codec: "hdmv_pgs_subtitle",
        },
        { run },
      ),
    ).rejects.toThrow("bitmap");
  });
  it("inspects a real generated video with the system ffprobe", async () => {
    const root = await mkdtemp(
      path.join(await realpath(tmpdir()), "media-probe-test-"),
    );
    roots.push(root);
    const filename = path.join(root, "fixture.mkv");
    await runMediaTool(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:d=0.2",
        "-c:v",
        "ffv1",
        filename,
      ],
      { timeoutMs: 10_000, maxBytes: 1024 },
    );
    const media = await inspectMedia(filename);
    expect(media.streams[0]?.width).toBe(64);
    expect(Number(media.format.duration)).toBeGreaterThan(0);
  });
});

describe("bounded archive extraction", () => {
  it("uses real 7zz to select one exact episode without extracting sibling paths", async () => {
    const root = await mkdtemp(
      path.join(await realpath(tmpdir()), "media-archive-test-"),
    );
    roots.push(root);
    const bytes = await extractSubtitleArchive({
      bytes: archiveBytes,
      member: "Fixture.S01E02.srt",
      temporaryRoot: root,
    });
    expect(new TextDecoder().decode(bytes)).toContain("Two");
    expect(new TextDecoder().decode(bytes)).not.toContain("One");
    await expect(
      extractSubtitleArchive({
        bytes: archiveBytes,
        member: "*.srt",
        temporaryRoot: root,
      }),
    ).rejects.toThrow("selection");
  });
  it("rejects real traversal archives before extraction", async () => {
    const root = await mkdtemp(
      path.join(await realpath(tmpdir()), "media-archive-test-"),
    );
    roots.push(root);
    await expect(
      extractSubtitleArchive({
        bytes: traversalBytes,
        member: "../escape.srt",
        temporaryRoot: root,
      }),
    ).rejects.toThrow("Unsafe");
  });
  it("rejects symlinks, oversized members, and duplicate entry names", () => {
    expect(() =>
      parseArchiveListing(
        "Path = linked.srt\nFolder = -\nSize = 10\nEncrypted = -\nAttributes = A lrwxrwxrwx\n",
      ),
    ).toThrow("links");
    expect(() =>
      parseArchiveListing(
        "Path = huge.srt\nFolder = -\nSize = 999999999\nEncrypted = -\n",
      ),
    ).toThrow("expanded");
    const entry =
      "Path = duplicate.srt\nFolder = -\nSize = 10\nEncrypted = -\n";
    expect(() => parseArchiveListing(`${entry}\n${entry}`)).toThrow(
      "Duplicate",
    );
  });
});
