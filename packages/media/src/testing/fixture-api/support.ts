/**
 * Deterministic identifiers and a single clock for the fixture API.
 *
 * Fixture times are offsets from the moment the process started, so pages that
 * render relative to "now" (the calendar month, removal deadlines, live
 * playback) always show current-looking data.
 */

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const GIBIBYTE = 1024 ** 3;

export const NOW = Date.now();

export function ago(milliseconds: number): string {
  return new Date(NOW - milliseconds).toISOString();
}

export function ahead(milliseconds: number): string {
  return new Date(NOW + milliseconds).toISOString();
}

/** A version-4-shaped UUID that encodes a namespace and a sequence number. */
export function fixtureId(namespace: number, sequence: number): string {
  return `${namespace.toString(16).padStart(8, "0")}-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
}

const FIXTURE_ID = /^([0-9a-f]{8})-0000-4000-8000-([0-9a-f]{12})$/u;

export function parseFixtureId(
  id: string,
): { namespace: number; sequence: number } | null {
  const match = FIXTURE_ID.exec(id);
  if (match === null) {
    return null;
  }
  const [, namespace, sequence] = match;
  if (namespace === undefined || sequence === undefined) {
    return null;
  }
  return {
    namespace: Number.parseInt(namespace, 16),
    sequence: Number.parseInt(sequence, 16),
  };
}

/**
 * An identifier for something owned by one media item (an asset, an event, a
 * candidate release), unique across items and across media kinds.
 */
export function derivedId(
  namespace: number,
  mediaId: string,
  ordinal: number,
): string {
  const parsed = parseFixtureId(mediaId);
  if (parsed === null) {
    throw new Error(`Not a fixture media identifier: ${mediaId}`);
  }
  return fixtureId(
    namespace,
    parsed.namespace * 100_000_000 + parsed.sequence * 10 + ordinal,
  );
}

export function sha256(seed: string): string {
  return new Bun.CryptoHasher("sha256").update(seed).digest("hex");
}

export function sha1(seed: string): string {
  return new Bun.CryptoHasher("sha1").update(seed).digest("hex");
}

/** Cycle through a non-empty list; fixtures use it to spread variants evenly. */
export function pick<T>(list: readonly T[], index: number): T {
  const value = list[index % list.length];
  if (value === undefined) {
    throw new Error("pick requires a non-empty list");
  }
  return value;
}

/** The record version shown for an identifier: stable, small, and varied. */
export function versionOf(id: string): number {
  return (Number.parseInt(id.slice(-3), 16) % 6) + 1;
}
