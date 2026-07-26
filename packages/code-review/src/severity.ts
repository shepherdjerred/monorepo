/**
 * Severity-badge parsing. Every provider annotates a finding with a P0..P3
 * badge, but the markup differs. Each provider exposes its own precise parser
 * (used by the gate, where over-matching a stray "P2" in prose would be
 * wrong); `parseSeverityLevel` is the generic, author-agnostic token parser
 * used by pr-babysit, which classifies threads from any provider at once.
 */

import { REVIEW_SEVERITIES, type ReviewSeverity } from "./types.ts";

/** Human label for a numeric severity level (`2` → `"P2"`, `null` → `"P?"`). */
export function severityLabel(level: number | null): string {
  return level === null ? "P?" : `P${String(level)}`;
}

/** Map a numeric level (0..3) to its `ReviewSeverity`, or undefined. */
export function severityFromLevel(
  level: number | null,
): ReviewSeverity | undefined {
  if (level === null) return undefined;
  return REVIEW_SEVERITIES[level];
}

const GENERIC_SEVERITY_RE = /\bP([0-3])\b/gu;

/**
 * Generic, provider-agnostic severity parse: the most-severe `P0`..`P3` token
 * anywhere in the body (lower number = more severe). Matches both Greptile's
 * `alt="P2"` and Codex's `P2 Badge` text. Returns null when no token present.
 */
export function parseSeverityLevel(
  body: string | null | undefined,
): number | null {
  if (typeof body !== "string" || body.length === 0) return null;
  let best: number | null = null;
  for (const match of body.matchAll(GENERIC_SEVERITY_RE)) {
    const raw = match[1];
    if (raw === undefined) continue;
    const n = Number.parseInt(raw, 10);
    if (best === null || n < best) best = n;
  }
  return best;
}

/**
 * Greptile priority badge. Greptile badges look like:
 *   `<a href="#"><img alt="P2" src="https://…/badges/p2.svg?v=9" …></a>`
 */
export function parseGreptileSeverity(body: string | null): number | null {
  if (body === null) return null;
  const altMatch = /alt="P([0-3])"/iu.exec(body);
  if (altMatch?.[1] !== undefined) return Number.parseInt(altMatch[1], 10);
  const badgeMatch = /badges\/p([0-3])\.svg/iu.exec(body);
  if (badgeMatch?.[1] !== undefined) return Number.parseInt(badgeMatch[1], 10);
  return null;
}

/**
 * Codex priority badge. Codex badges are shields.io images in markdown:
 *   `![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)`
 * Match the shields badge path first, then the markdown alt text.
 */
export function parseCodexSeverity(body: string | null): number | null {
  if (body === null) return null;
  const badgeMatch = /badge\/P([0-3])-/iu.exec(body);
  if (badgeMatch?.[1] !== undefined) return Number.parseInt(badgeMatch[1], 10);
  const altMatch = /!\[P([0-3]) Badge\]/iu.exec(body);
  if (altMatch?.[1] !== undefined) return Number.parseInt(altMatch[1], 10);
  return null;
}
