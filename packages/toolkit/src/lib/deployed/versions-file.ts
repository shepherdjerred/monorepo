/**
 * Parser for packages/homelab/src/cdk8s/src/versions.ts.
 *
 * versions.ts is `export default versions;` over a plain object literal. We
 * regex the raw text instead of evaluating TS — robust, dependency-free, and
 * safe to run against arbitrary historical revisions fetched via `git show`.
 *
 * Only first-party "shepherdjerred/..." entries pinned as "2.0.0-<build>@sha256:..."
 * are extracted; third-party images (renovate-managed) are ignored.
 */
import type { Pin } from "./types.ts";

const PIN_RE =
  /"(shepherdjerred\/[^"]+)":\s*"(2\.0\.0-(\d+))@(sha256:[a-f0-9]+)"/g;

/** Parse all first-party pins from versions.ts text into a versionKey → Pin map. */
export function parseVersionsFile(text: string): Map<string, Pin> {
  const out = new Map<string, Pin>();
  for (const m of text.matchAll(PIN_RE)) {
    const versionKey = m[1];
    const tag = m[2];
    const buildRaw = m[3];
    const digest = m[4];
    if (
      versionKey == null ||
      tag == null ||
      buildRaw == null ||
      digest == null
    ) {
      continue;
    }
    out.set(versionKey, {
      versionKey,
      tag,
      build: Number.parseInt(buildRaw, 10),
      digest,
    });
  }
  return out;
}
