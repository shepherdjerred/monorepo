/**
 * Pulling identities out of an archived Riot payload.
 *
 * The corpus turns out to be self-describing: every `match.json` participant
 * carries `riotIdGameName`/`riotIdTagline` beside its `puuid`, and every
 * `spectator-data.json` participant carries `riotId`. Measured across 259,936
 * prod participant rows and 90,616 beta ones, not one was blank.
 *
 * That Riot ID is a SNAPSHOT FROM GAME TIME, not the truth. A player who
 * renamed afterwards may have had their old handle claimed by someone else, so
 * resolving it would map them onto a stranger — a 200, not a 404. It is
 * collected as a cross-check and a record of what the payload said, never as
 * the mapping itself; the old key remains the authority for who an old PUUID
 * belongs to.
 *
 * Timelines carry PUUIDs with no Riot ID at all, which is fine: a timeline
 * shares its match id with a match object that has them.
 */

import { z } from "zod";

/** One appearance of an identity in one archived document. */
export type Sighting = {
  puuid: string;
  /** `gameName#tagLine` as the payload recorded it, when it recorded one. */
  riotId: string | null;
  /** Game time in epoch millis; newer sightings win. 0 when undatable. */
  at: number;
};

/** PUUIDs are 78-char base64url; anything else is not one. */
const PuuidSchema = z.string().regex(/^[\w-]{70,90}$/u);

/** The value as a PUUID, or null when it is not one. */
function asPuuid(value: unknown): string | null {
  const parsed = PuuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? z.record(z.string(), z.unknown()).parse(value)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Join a game name and tag into the canonical form, or nothing.
 *
 * Both halves must be present. A blank tag would produce `Name#`, which cannot
 * be resolved and would look like a real handle in the inventory.
 */
function riotIdFrom(name: unknown, tag: unknown): string | null {
  return typeof name === "string" &&
    typeof tag === "string" &&
    name !== "" &&
    tag !== ""
    ? `${name}#${tag}`
    : null;
}

/** Riot IDs split on the LAST `#`: a game name may contain spaces, never `#`. */
export function splitRiotId(
  riotId: string,
): { gameName: string; tagLine: string } | null {
  const hash = riotId.lastIndexOf("#");
  if (hash <= 0 || hash === riotId.length - 1) {
    return null;
  }
  return {
    gameName: riotId.slice(0, hash),
    tagLine: riotId.slice(hash + 1),
  };
}

function matchSightings(doc: Record<string, unknown>): Sighting[] {
  const info = asRecord(doc["info"]);
  const at =
    asNumber(info?.["gameEndTimestamp"]) || asNumber(info?.["gameCreation"]);
  const out: Sighting[] = [];

  for (const raw of asArray(info?.["participants"])) {
    const participant = asRecord(raw);
    const puuid = asPuuid(participant?.["puuid"]);
    if (puuid === null) {
      continue;
    }
    out.push({
      puuid,
      riotId: riotIdFrom(
        participant?.["riotIdGameName"],
        participant?.["riotIdTagline"],
      ),
      at,
    });
  }

  // `metadata.participants` is the same roster as a bare id list. Including it
  // covers a document whose `info` block is shaped differently from today's,
  // at the cost of nothing: a duplicate sighting with no Riot ID never wins.
  const metadata = asRecord(doc["metadata"]);
  for (const raw of asArray(metadata?.["participants"])) {
    const puuid = asPuuid(raw);
    if (puuid !== null) {
      out.push({ puuid, riotId: null, at });
    }
  }
  return out;
}

function timelineSightings(doc: Record<string, unknown>): Sighting[] {
  const out: Sighting[] = [];
  const info = asRecord(doc["info"]);
  for (const raw of asArray(info?.["participants"])) {
    const puuid = asPuuid(asRecord(raw)?.["puuid"]);
    if (puuid !== null) {
      out.push({ puuid, riotId: null, at: 0 });
    }
  }
  const metadata = asRecord(doc["metadata"]);
  for (const raw of asArray(metadata?.["participants"])) {
    const puuid = asPuuid(raw);
    if (puuid !== null) {
      out.push({ puuid, riotId: null, at: 0 });
    }
  }
  return out;
}

function prematchSightings(doc: Record<string, unknown>): Sighting[] {
  const at = asNumber(doc["gameStartTime"]);
  const out: Sighting[] = [];
  for (const raw of asArray(doc["participants"])) {
    const participant = asRecord(raw);
    const puuid = asPuuid(participant?.["puuid"]);
    if (puuid === null) {
      continue;
    }
    const riotId = participant?.["riotId"];
    out.push({
      puuid,
      riotId:
        typeof riotId === "string" && riotId.includes("#") ? riotId : null,
      at,
    });
  }
  return out;
}

/**
 * Identities in a document of no recognised shape.
 *
 * Structural rather than schema-driven, because the point is to cover documents
 * nobody enumerated: failed validation payloads, AI pipeline summaries,
 * prediction observations. They carry no handle, which costs nothing — the old
 * key is the authority for a handle regardless, and a handle-less sighting
 * never displaces one a match knew.
 *
 * Matching on shape is safe HERE and would not be safe for deciding what to
 * rewrite. Collecting a non-identity token that merely looks like a PUUID
 * wastes one lookup that returns 404; rewriting on the same evidence would
 * corrupt a document.
 */
export function unknownShapeSightings(body: string): Sighting[] {
  const out: Sighting[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(/[\w-]{70,90}/gu)) {
    const token = match[0];
    if (!seen.has(token)) {
      seen.add(token);
      out.push({ puuid: token, riotId: null, at: 0 });
    }
  }
  return out;
}

/** Every identity one archived document names, with whatever handle it knew. */
export function sightingsIn(
  kind: "match" | "timeline" | "prematch" | "other",
  parsed: unknown,
): Sighting[] {
  const doc = asRecord(parsed);
  if (doc === null) {
    return [];
  }
  if (kind === "match") {
    return matchSightings(doc);
  }
  if (kind === "timeline") {
    return timelineSightings(doc);
  }
  if (kind === "prematch") {
    return prematchSightings(doc);
  }
  // A document of an unrecognised shape may still be a match payload — a failed
  // validation is one — so try the known readers before falling back.
  const known = [
    ...matchSightings(doc),
    ...timelineSightings(doc),
    ...prematchSightings(doc),
  ];
  return known;
}

/**
 * Fold sightings into one entry per identity, newest handle winning.
 *
 * Newest rather than most common because a rename makes every older sighting
 * wrong, and 1.09% of prod's identities show more than one handle. The archived
 * handle is only ever a cross-check, but a stale one would make the check
 * disagree with the old key on identities that are perfectly fine.
 */
export function foldSightings(
  into: Map<string, { riotId: string | null; at: number }>,
  sightings: readonly Sighting[],
): void {
  for (const sighting of sightings) {
    const existing = into.get(sighting.puuid);
    if (existing === undefined) {
      into.set(sighting.puuid, { riotId: sighting.riotId, at: sighting.at });
      continue;
    }
    if (sighting.riotId !== null && sighting.at >= existing.at) {
      existing.riotId = sighting.riotId;
      existing.at = sighting.at;
    }
  }
}
