/**
 * Low-level GitHub HTTP + JSON-narrowing helpers shared by `./github.ts`.
 * Kept separate so the domain fetches stay focused. Untyped JSON is narrowed
 * with these accessors (never cast) per the repo's no-type-assertions rule.
 */

import { z } from "zod";

export const GITHUB_API_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

export const CheckConclusionSchema = z.enum([
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "startup_failure",
  "stale",
]);
export type CheckConclusion = z.infer<typeof CheckConclusionSchema> | null;

const RecordSchema = z.record(z.string(), z.unknown());

export function asRecord(value: unknown): Record<string, unknown> | null {
  const result = RecordSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function recordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  return asRecord(record[key]);
}

/**
 * A REQUIRED array field from a GitHub response. Throws when the value is
 * missing or not an array rather than treating an unexpected shape as an empty
 * list: for the review gate, silently coercing a malformed `reviewThreads.nodes`
 * / `comments.nodes` / `check_runs` to `[]` would let a completed review pass
 * with its (possibly blocking) findings omitted. A genuinely empty connection
 * is still a valid `[]` and passes through.
 */
export function arrayField(
  record: Record<string, unknown>,
  key: string,
): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new TypeError(
      `Expected GitHub response field "${key}" to be an array, got ${value === null ? "null" : typeof value}`,
    );
  }
  return value;
}

export function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

export function numberField(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function boolField(
  record: Record<string, unknown>,
  key: string,
): boolean {
  return record[key] === true;
}

export function conclusionField(value: string | null): CheckConclusion {
  const result = CheckConclusionSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Extract the `rel="next"` URL from a GitHub `Link` header, if present. */
export function parseLinkNext(header: string | null): string | null {
  if (header === null) return null;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="next"/u.exec(part);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

export async function getJsonWithLink(
  url: string,
  token: string,
): Promise<{ payload: unknown; linkNext: string | null }> {
  const response = await fetch(url, { headers: githubHeaders(token) });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API request failed with ${String(response.status)} ${response.statusText}: ${body}`,
    );
  }
  const payload: unknown = await response.json();
  return { payload, linkNext: parseLinkNext(response.headers.get("link")) };
}

export async function graphqlRequest(
  query: string,
  variables: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  const response = await fetch(`${GITHUB_API_URL}/graphql`, {
    method: "POST",
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub GraphQL request failed with ${String(response.status)} ${response.statusText}: ${body}`,
    );
  }
  const payload: unknown = await response.json();
  const errors = asRecord(payload)?.["errors"];
  if (errors !== undefined) {
    throw new Error(
      `GitHub GraphQL returned errors: ${JSON.stringify(errors)}`,
    );
  }
  return payload;
}

export function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (
    owner === undefined ||
    name === undefined ||
    owner === "" ||
    name === ""
  ) {
    throw new Error(`Expected repository in owner/name form, got ${repo}`);
  }
  return { owner, name };
}
