import path from "node:path";
import { lstat } from "node:fs/promises";
import type { ContentProof } from "#filesystem/content-proof.ts";
import type { MediaProbe } from "#filesystem/media-tools.ts";
import { safePath } from "#filesystem/operations-io.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  NativeSubtitleEvidenceSchema,
  type NativeSubtitleEvidence,
  type NativeSubtitleSnapshot,
} from "#shared/native-subtitles.ts";
import { unmanagedSidecars } from "#automation/handoff/sidecars.ts";

export type NativeSubtitleFile = {
  assetId: string;
  assetVersion: number;
  canonicalPath: string;
  checksum: string;
  ownershipEpoch: number;
  subtitles: NativeSubtitleSnapshot[];
};
type Stream = NativeSubtitleEvidence["stream"];
export type NativeSubtitlePathResolver = (canonicalPath: string) => string;
export type CapturedNativeSubtitles = {
  file: NativeSubtitleFile;
  streams: Map<string, Stream>;
  neighbors: string[];
  resolvePath?: NativeSubtitlePathResolver;
};

/** Trusted worker injection only; production has identity mapping. Never read it from plan JSON. */
export function nativeSubtitleLocalPath(
  canonicalPath: string,
  resolvePath?: NativeSubtitlePathResolver,
): string {
  const local =
    resolvePath === undefined ? canonicalPath : resolvePath(canonicalPath);
  if (!path.isAbsolute(local) || path.normalize(local) !== local)
    throw new Error("Native subtitle executor path is not canonical");
  return local;
}

/** Capture before content.seal(), outside PG; it only reads the exact reviewed files. */
export async function captureNativeSubtitles(input: {
  file: NativeSubtitleFile;
  libraryRoot: string;
  content: ContentProof;
  probe: MediaProbe;
  checkpoint: () => Promise<void>;
  resolvePath?: NativeSubtitlePathResolver;
}): Promise<CapturedNativeSubtitles> {
  const { file, content } = input;
  const videoPath = nativeSubtitleLocalPath(
    file.canonicalPath,
    input.resolvePath,
  );
  if (
    (await safePath(
      input.libraryRoot,
      path.relative(input.libraryRoot, videoPath),
      false,
    )) !== videoPath
  )
    throw new Error("Native subtitle video escapes canonical library root");
  const streams = new Map<string, Stream>();
  const neighbors = await assertNativeSubtitleNeighbors(
    file,
    input.resolvePath,
  );
  for (const subtitle of file.subtitles) {
    if (
      subtitle.assetId !== file.assetId ||
      subtitle.ownershipEpoch !== file.ownershipEpoch ||
      subtitle.videoVersion !== file.assetVersion ||
      subtitle.videoChecksum !== file.checksum
    )
      throw new Error("Native subtitle video binding is inconsistent");
    if (subtitle.storageKind === "embedded") {
      streams.set(subtitle.id, nativeEmbeddedStream(input.probe, subtitle));
      continue;
    }
    if (
      subtitle.path === null ||
      subtitle.checksum === null ||
      subtitle.streamIndex !== null
    )
      throw new Error("Native sidecar has incomplete stored identity");
    const localPath = nativeSubtitleLocalPath(subtitle.path, input.resolvePath);
    const relative = path.relative(input.libraryRoot, localPath);
    if ((await safePath(input.libraryRoot, relative, false)) !== localPath)
      throw new Error("Native subtitle canonical path changed");
    assertSameDirectorySidecar(subtitle.path, file.canonicalPath);
    assertSameDirectorySidecar(localPath, videoPath);
    const info = await lstat(localPath);
    if (info.size > 8 * 1024 * 1024)
      throw new Error("Native subtitle exceeds inspection bound");
    await content.capture(localPath, input.checkpoint);
    streams.set(subtitle.id, null);
  }
  if (
    snapshotHash(
      await assertNativeSubtitleNeighbors(file, input.resolvePath),
    ) !== snapshotHash(neighbors)
  )
    throw new Error("Native subtitle neighbors changed during inspection");
  return {
    file,
    streams,
    neighbors,
    ...(input.resolvePath === undefined
      ? {}
      : { resolvePath: input.resolvePath }),
  };
}

function assertSameDirectorySidecar(sidecar: string, video: string): void {
  if (sidecar === video || path.dirname(sidecar) !== path.dirname(video))
    throw new Error("Native subtitle is not a same-directory video sidecar");
}

/** Assemble serializable review evidence only after the shared content capability is sealed. */
export async function nativeSubtitleEvidence(
  content: ContentProof,
  captured: CapturedNativeSubtitles,
): Promise<NativeSubtitleEvidence[]> {
  const { file } = captured;
  if (
    (await content.digest(
      nativeSubtitleLocalPath(file.canonicalPath, captured.resolvePath),
    )) !== file.checksum
  )
    throw new Error("Native subtitle video bytes changed");
  const result: NativeSubtitleEvidence[] = [];
  for (const subtitle of file.subtitles) {
    const proof =
      subtitle.path === null
        ? null
        : await content.verifiedFile(
            nativeSubtitleLocalPath(subtitle.path, captured.resolvePath),
          );
    if (
      proof !== null &&
      (proof.sha256 !== subtitle.checksum ||
        BigInt(proof.sizeBytes) > 8n * 1024n * 1024n)
    )
      throw new Error("Native subtitle bytes changed");
    result.push(
      NativeSubtitleEvidenceSchema.parse({
        id: subtitle.id,
        assetId: subtitle.assetId,
        snapshotHash: snapshotHash(subtitle),
        videoChecksum: file.checksum,
        canonicalPath: subtitle.path,
        checksum: proof?.sha256 ?? subtitle.checksum,
        sizeBytes: proof?.sizeBytes ?? null,
        identity:
          subtitle.path === null
            ? null
            : await content.reviewIdentity(
                nativeSubtitleLocalPath(subtitle.path, captured.resolvePath),
              ),
        storageKind: subtitle.storageKind,
        qualityStatus: subtitle.qualityStatus,
        stream: captured.streams.get(subtitle.id) ?? null,
      }),
    );
  }
  return result;
}

/** Called again under the caller's final sorted path locks. Unknown neighbors grant no authority. */
export async function assertNativeSubtitleNeighbors(
  file: NativeSubtitleFile,
  resolvePath?: NativeSubtitlePathResolver,
): Promise<string[]> {
  const neighbors = await unmanagedSidecars(
    nativeSubtitleLocalPath(file.canonicalPath, resolvePath),
  );
  const actual = neighbors.map((item) => item.canonicalPath).sort();
  const expected = file.subtitles
    .flatMap((item) =>
      item.storageKind === "sidecar" && item.path !== null ? [item.path] : [],
    )
    .sort();
  const localExpected = expected
    .map((item) => nativeSubtitleLocalPath(item, resolvePath))
    .sort();
  if (
    new Set(expected).size !== expected.length ||
    new Set(localExpected).size !== expected.length ||
    snapshotHash(actual) !== snapshotHash(localExpected)
  )
    throw new Error(
      "Native subtitle neighbor inventory contains unknown or missing sidecars",
    );
  return expected;
}

export function nativeEmbeddedStream(
  probe: MediaProbe,
  subtitle: Pick<
    NativeSubtitleSnapshot,
    "path" | "streamIndex" | "codec" | "language" | "forced" | "hearingImpaired"
  >,
): NonNullable<Stream> {
  const matches = probe.streams.filter(
    (item) =>
      item.index === subtitle.streamIndex && item.codec_type === "subtitle",
  );
  const stream = matches[0];
  if (
    subtitle.path !== null ||
    subtitle.streamIndex === null ||
    subtitle.codec === null ||
    matches.length !== 1 ||
    stream?.codec_name !== subtitle.codec
  )
    throw new Error("Native embedded subtitle stream identity changed");
  const language = stream.tags?.language ?? null;
  const forced =
    stream.disposition?.forced === undefined
      ? null
      : stream.disposition.forced === 1;
  const hearingImpaired =
    stream.disposition?.hearing_impaired === undefined
      ? null
      : stream.disposition.hearing_impaired === 1;
  if (
    baseLanguage(language) !== baseLanguage(subtitle.language) ||
    (subtitle.forced !== null && subtitle.forced !== forced) ||
    (subtitle.hearingImpaired !== null &&
      subtitle.hearingImpaired !== hearingImpaired)
  )
    throw new Error("Native embedded subtitle metadata changed");
  // Generic Chinese stream tags do not establish script quality. The proven same
  // video checksum preserves prior text-validation evidence without relabelling it.
  return {
    index: stream.index,
    codec: subtitle.codec,
    language,
    forced,
    hearingImpaired,
  };
}

function baseLanguage(value: string | null): string | null {
  if (value === null) return null;
  if (
    ["chi", "zho", "zh", "zh-Hans", "zh-CN", "zh-TW", "zh-Hant"].includes(value)
  )
    return "zh";
  return value === "eng" ? "en" : value;
}
