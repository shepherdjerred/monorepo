import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ReplayPatchObservationSchema,
  type ReplayPatchObservation,
} from "@scout-for-lol/domain/artifacts/replay-support.ts";

const PlatformSchema = z.string().regex(/^[A-Z]{2,4}\d{0,2}$/);
const VersionsSchema = z.object({
  compat_versions: z.array(z.object({ id: z.string().min(1) })).min(1),
});
const MAX_RELEASE_RESPONSE_BYTES = 1024 * 1024;
const RELEASE_TIMEOUT_MS = 20_000;

/** Riot's release revision packs the native build and four-digit revision together. */
export function nativeBuildFromReleaseVersion(version: string): string {
  const match =
    /^(\d{1,2})\.(\d{1,2})\.(\d{5,12})\+branch\.releases-(\d{1,2})-(\d{1,2})\.[a-z0-9.-]+$/.exec(
      version,
    );
  if (match === null)
    throw new Error("Unrecognized official League release identity");
  const [, major, minor, revision, branchMajor, branchMinor] = match;
  if (
    revision === undefined ||
    major === undefined ||
    minor === undefined ||
    Number(major) !== Number(branchMajor) ||
    Number(minor) !== Number(branchMinor)
  )
    throw new Error(
      "Official League release branch does not match its version",
    );
  return [major, minor, revision.slice(0, -4), revision.slice(-4)]
    .map((part) => String(Number(part)))
    .join(".");
}

function compareBuilds(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (const [index, part] of a.entries()) {
    const other = b[index];
    if (other === undefined)
      throw new Error("Official game build has inconsistent components");
    const difference = part - other;
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Public release discovery establishes identity, never decoder or renderer admission. */
export async function observeReplayPatch(
  platformId: string,
  options: {
    fetch?: typeof fetch;
    now?: () => Date;
    signal?: AbortSignal;
  } = {},
): Promise<ReplayPatchObservation> {
  const platform = PlatformSchema.parse(platformId);
  const sourceUrl = `https://sieve.services.riotcdn.net/api/v1/products/lol/version-sets/${platform}/versions?platform=windows`;
  const signal =
    options.signal === undefined
      ? AbortSignal.timeout(RELEASE_TIMEOUT_MS)
      : AbortSignal.any([
          options.signal,
          AbortSignal.timeout(RELEASE_TIMEOUT_MS),
        ]);
  const response = await (options.fetch ?? fetch)(sourceUrl, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal,
  });
  if (response.status !== 200)
    throw new Error(
      `Official League release observation failed: HTTP ${String(response.status)}`,
    );
  const reader = response.body?.getReader();
  if (reader === undefined)
    throw new Error("Official League release response has no body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = z.instanceof(Uint8Array).parse(result.value);
      length += chunk.byteLength;
      if (length > MAX_RELEASE_RESPONSE_BYTES)
        throw new Error(
          "Official League release response exceeds its size limit",
        );
      chunks.push(chunk);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the original failed read when cancellation races stream closure.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  const document = VersionsSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  const builds = document.compat_versions.map(({ id }) =>
    nativeBuildFromReleaseVersion(id),
  );
  builds.sort(compareBuilds);
  const gameBuild = builds.at(-1);
  if (gameBuild === undefined)
    throw new Error("Official League release has no game build");
  return ReplayPatchObservationSchema.parse({
    platformId: platform,
    patch: gameBuild.split(".").slice(0, 2).join("."),
    gameBuild,
    sourceUrl,
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    observedAt: (options.now ?? (() => new Date()))().toISOString(),
  });
}
