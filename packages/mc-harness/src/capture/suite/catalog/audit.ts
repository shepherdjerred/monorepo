import path from "node:path";
import { lstat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import sharp from "sharp";
import { z } from "zod";
import {
  PublicMediaSchema,
  type PublicMedia,
  type Presentation,
} from "#protocol/media.ts";
import { sha256 } from "#src/capture/media.ts";
import {
  selectScenarios,
  type CaptureSuite,
} from "#src/capture/suite/define.ts";
import { docsCoverage } from "#src/capture/suite/docs-coverage.ts";
import { command } from "#src/capture/suite/process.ts";

export type CatalogEntry = {
  scenario: string;
  media: PublicMedia;
  files: string[];
};
export type CatalogIssue = {
  scenario: string;
  shot: string;
  file: string;
  message: string;
};
export const mediaFiles = (media: PublicMedia) => [
  "media.json",
  "poster.webp",
  media.kind === "image" ? "original.webp" : "clip.mp4",
  media.kind === "image" ? "annotated.webp" : "annotated.mp4",
];

/** Never follow linked directories or files into private capture data. */
export async function publicFile(root: string, relative: string) {
  const parts = relative.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    throw new Error("Invalid public media path");
  let current = root;
  for (const part of ["", ...parts]) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error("Linked public media path");
  }
  const final = await lstat(current);
  if (!final.isFile()) throw new Error("Expected public media file");
  return current;
}

const ProbeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      avg_frame_rate: z.string().optional(),
      nb_read_frames: z.coerce.number().int().positive().optional(),
      duration: z.coerce.number().positive().optional(),
    }),
  ),
});
export async function probeVideo(file: string) {
  const probe = ProbeSchema.parse(
    JSON.parse(
      await command([
        "ffprobe",
        "-v",
        "error",
        "-count_frames",
        "-show_streams",
        "-of",
        "json",
        file,
      ]),
    ),
  );
  const stream = probe.streams.find((s) => s.codec_type === "video");
  if (
    stream?.duration === undefined ||
    stream.nb_read_frames === undefined ||
    stream.width === undefined ||
    stream.height === undefined ||
    stream.avg_frame_rate !== "30/1"
  )
    throw new Error("Expected a complete 30 FPS video stream");
  return {
    width: stream.width,
    height: stream.height,
    frames: stream.nb_read_frames,
    duration: stream.duration,
  };
}

function validatePresentation(media: PublicMedia, authored: Presentation) {
  if (media.name !== authored.name)
    throw new Error("Manifest identity differs");
  if (media.alt !== authored.alt || media.caption !== authored.caption)
    throw new Error("Authored caption or alt text differs; rerender this shot");
  const geometry = (cues: typeof media.annotations) =>
    cues.map(({ atStep: _step, startMs: _start, endMs: _end, ...cue }) => cue);
  if (
    !isDeepStrictEqual(
      geometry(media.annotations),
      geometry(authored.annotations),
    )
  )
    throw new Error(
      "Authored annotation geometry or text differs; rerender this shot",
    );
  for (const [index, cue] of authored.annotations.entries()) {
    const published = media.annotations[index];
    if (
      published === undefined ||
      published.endMs - published.startMs !== cue.endMs - cue.startMs ||
      (cue.atStep === undefined &&
        (published.startMs !== cue.startMs || published.endMs !== cue.endMs))
    )
      throw new Error("Authored annotation timing differs; rerender this shot");
  }
}

async function validateFiles(media: PublicMedia, publicRoot: string) {
  let video: Awaited<ReturnType<typeof probeVideo>> | undefined;
  for (const name of mediaFiles(media)) {
    const file = `media/${media.name}/${name}`;
    const target = await publicFile(publicRoot, file);
    if (name.endsWith(".webp")) {
      const image = await sharp(target).metadata();
      if (image.width !== media.width || image.height !== media.height)
        throw new Error(`${file}: Image dimensions differ`);
    } else if (name.endsWith(".mp4")) {
      const info = await probeVideo(target);
      if (
        info.width !== media.width ||
        info.height !== media.height ||
        (video !== undefined && !isDeepStrictEqual(video, info))
      )
        throw new Error(
          `${file}: Video dimensions, duration or frame counts differ`,
        );
      video = info;
    }
  }
  if (
    video !== undefined &&
    media.annotations.some((cue) => cue.endMs > video.duration * 1000)
  )
    throw new Error("Annotation extends beyond clip duration");
}

export async function auditCatalog(
  suite: CaptureSuite,
  publicRoot: string,
  selection: { scenario?: string | undefined; shot?: string | undefined } = {},
  docsRoot?: string,
) {
  const entries: CatalogEntry[] = [],
    issues: CatalogIssue[] = [];
  for (const scenario of selectScenarios(suite, selection)) {
    for (const authored of scenario.shots.filter(
      (s) => selection.shot === undefined || s.name === selection.shot,
    )) {
      const file = `media/${authored.name}/media.json`;
      try {
        const media = PublicMediaSchema.parse(
          await Bun.file(await publicFile(publicRoot, file)).json(),
        );
        validatePresentation(media, authored);
        const files = mediaFiles(media);
        await validateFiles(media, publicRoot);
        entries.push({ scenario: scenario.id, media, files });
      } catch (error) {
        issues.push({
          scenario: scenario.id,
          shot: authored.name,
          file,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  const names = new Set(
    selectScenarios(suite, selection).flatMap((s) =>
      s.shots
        .filter(
          (p) => selection.shot === undefined || p.name === selection.shot,
        )
        .map((p) => p.name),
    ),
  );
  issues.push(...(await auditAliases(suite, publicRoot, names)));
  if (selection.scenario === undefined && selection.shot === undefined) {
    const coverage = await docsCoverage(suite, publicRoot, docsRoot);
    for (const file of coverage.missing)
      issues.push({
        scenario: "docs",
        shot: "",
        file,
        message: "Missing asset or capture producer",
      });
  }
  return { suite: suite.id, entries, issues };
}

async function auditAliases(
  suite: CaptureSuite,
  publicRoot: string,
  names: Set<string>,
) {
  const issues: CatalogIssue[] = [];
  for (const alias of suite.legacyOutputs ?? []) {
    if (!names.has(alias.shot)) continue;
    try {
      const source = `media/${alias.shot}/${alias.path.endsWith(".mp4") ? "clip.mp4" : "original.webp"}`;
      if (
        (await sha256(await publicFile(publicRoot, alias.path.slice(1)))) !==
        (await sha256(await publicFile(publicRoot, source)))
      )
        throw new Error("Legacy alias bytes differ");
    } catch (error) {
      issues.push({
        scenario: "legacy",
        shot: alias.shot,
        file: alias.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return issues;
}
