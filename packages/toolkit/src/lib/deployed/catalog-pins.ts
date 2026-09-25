/**
 * Pins for `toolkit deployed`, read from the version catalog
 * (packages/version-catalog/src/catalog.json).
 *
 * The catalog is validated with its own package's schema, so a historical
 * revision fetched via `git show` is parsed exactly as the homelab reads it.
 *
 * Only first-party "shepherdjerred/..." entries pinned as
 * "2.0.0-<build>@sha256:..." are extracted; third-party images and charts are
 * ignored.
 */
import { parseVersionCatalogText } from "@shepherdjerred/version-catalog";
import type { Pin } from "./types.ts";

const FIRST_PARTY_PIN = /^(2\.0\.0-(\d+))@(sha256:[a-f0-9]+)$/;

/** Parse all first-party pins from catalog text into a versionKey → Pin map. */
export function parseCatalogPins(text: string): Map<string, Pin> {
  const out = new Map<string, Pin>();
  for (const entry of parseVersionCatalogText(text).entries) {
    if (!entry.name.startsWith("shepherdjerred/")) {
      continue;
    }
    const match = FIRST_PARTY_PIN.exec(entry.value);
    const tag = match?.[1];
    const buildRaw = match?.[2];
    const digest = match?.[3];
    if (tag === undefined || buildRaw === undefined || digest === undefined) {
      continue;
    }
    out.set(entry.name, {
      versionKey: entry.name,
      tag,
      build: Number.parseInt(buildRaw, 10),
      digest,
    });
  }
  return out;
}
