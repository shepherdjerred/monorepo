import { z } from "zod";
import { CaptureReadError } from "#migration/capture/capture-http.ts";

const Source = z.enum(["local", "radarr", "sonarr"]);
const Stage = z.enum([
  "arguments",
  "configuration",
  "destination",
  "profiles_before",
  "installed_first",
  "installed_second",
  "profiles_after",
  "coherence",
  "sanitization",
  "persistence",
]);
const Endpoint = z.enum([
  "system/status",
  "qualityprofile",
  "customformat",
  "qualitydefinition",
  "config/mediamanagement",
  "movie",
  "moviefile",
  "series",
  "episode",
  "episodefile",
]);
export type CaptureEndpoint = z.infer<typeof Endpoint>;
const Reason = z.enum([
  "schema",
  "read_failed",
  "page_limit",
  "record_limit",
  "changed",
  "missing_reference",
  "duplicate_id",
  "forbidden_content",
  "io",
  "invalid_configuration",
  "unexpected",
]);
const IssueCode = z.enum([
  "invalid_type",
  "too_big",
  "too_small",
  "invalid_format",
  "not_multiple_of",
  "unrecognized_keys",
  "invalid_union",
  "invalid_key",
  "invalid_element",
  "invalid_value",
  "custom",
]);
const Artifact = z.enum(["profiles", "installed", "manifest"]);
const ContentFailure = z.strictObject({
  path: z.array(z.string()).max(20),
  subreason: z.enum([
    "credential_literal",
    "credential_pattern",
    "url_value",
    "forbidden_key",
  ]),
});
export const CaptureDiagnosticSchema = z.strictObject({
  source: Source,
  stage: Stage,
  endpoint: Endpoint.optional(),
  artifact: Artifact.optional(),
  content: ContentFailure.optional(),
  reason: Reason,
  issues: z
    .array(
      z.strictObject({ path: z.array(z.string()).max(20), code: IssueCode }),
    )
    .max(20)
    .optional(),
});
type Context = {
  source: z.infer<typeof Source>;
  stage: z.infer<typeof Stage>;
  endpoint?: z.infer<typeof Endpoint>;
  artifact?: z.infer<typeof Artifact>;
};
const fields = new Set([
  "inventories",
  "movies",
  "series",
  "episodes",
  "files",
  "source",
  "version",
  "profiles",
  "customFormats",
  "qualityDefinitions",
  "properPreference",
  "id",
  "title",
  "year",
  "tmdbId",
  "imdbId",
  "tvdbId",
  "alternateTitles",
  "runtime",
  "qualityProfileId",
  "monitored",
  "seriesId",
  "movieId",
  "seasonNumber",
  "episodeNumber",
  "absoluteEpisodeNumber",
  "episodeFileId",
  "path",
  "size",
  "quality",
  "name",
  "sourceVersion",
  "upgradeAllowed",
  "cutoff",
  "minFormatScore",
  "cutoffFormatScore",
  "minUpgradeFormatScore",
  "language",
  "items",
  "allowed",
  "formatItems",
  "format",
  "score",
  "resolution",
  "modifier",
  "includeCustomFormatWhenRenaming",
  "specifications",
  "implementation",
  "negate",
  "required",
  "fields",
  "value",
  "weight",
  "minSize",
  "maxSize",
  "preferredSize",
]);
export function captureSafePath(path: readonly PropertyKey[]) {
  return path
    .slice(0, 20)
    .map((part) =>
      typeof part === "number"
        ? "[]"
        : typeof part === "string" && fields.has(part)
          ? part
          : "<field>",
    );
}
export class PrivateCaptureContentError extends Error {
  readonly content: z.infer<typeof ContentFailure>;
  constructor(
    path: readonly PropertyKey[],
    subreason: z.infer<typeof ContentFailure>["subreason"],
  ) {
    super("Private capture contains forbidden content");
    this.content = ContentFailure.parse({
      path: captureSafePath(path),
      subreason,
    });
  }
}
export class PrivateCaptureError extends Error {
  readonly diagnostic: z.infer<typeof CaptureDiagnosticSchema>;
  constructor(diagnostic: z.infer<typeof CaptureDiagnosticSchema>) {
    super("Private installed capture failed");
    this.diagnostic = CaptureDiagnosticSchema.parse(diagnostic);
  }
}
function knownReason(error: unknown): z.infer<typeof Reason> {
  if (!(error instanceof Error)) return "unexpected";
  if (
    "code" in error &&
    typeof error.code === "string" &&
    [
      "EACCES",
      "EPERM",
      "EEXIST",
      "ENOENT",
      "ENOTDIR",
      "ELOOP",
      "ENOSPC",
    ].includes(error.code)
  )
    return "io";
  const messages: Readonly<Record<string, z.infer<typeof Reason>>> = {
    "Installed capture contains duplicate IDs": "duplicate_id",
    "Installed capture record limit exceeded": "record_limit",
    "Installed movie file parent changed": "changed",
    "Installed series parent changed": "changed",
    "Installed episode file missing": "missing_reference",
    "Installed catalog changed during capture": "changed",
    "Profiles or source version changed across installed capture": "changed",
    "Installed catalog references an uncaptured profile": "missing_reference",
    "Private capture contains forbidden credential or URL content":
      "forbidden_content",
    "Private capture contains a forbidden field": "forbidden_content",
    "Private capture destination already exists": "io",
    "radarr settings changed during inventory; retry the read": "changed",
    "sonarr settings changed during inventory; retry the read": "changed",
  };
  return Object.hasOwn(messages, error.message)
    ? (messages[error.message] ?? "unexpected")
    : "unexpected";
}
export function captureDiagnostic(
  error: unknown,
  context: Context,
): PrivateCaptureError {
  if (error instanceof PrivateCaptureError) return error;
  if (error instanceof PrivateCaptureContentError)
    return new PrivateCaptureError({
      ...context,
      reason: "forbidden_content",
      content: error.content,
    });
  if (error instanceof z.ZodError)
    return new PrivateCaptureError({
      ...context,
      reason: "schema",
      issues: error.issues.slice(0, 20).map((issue) => ({
        code: IssueCode.parse(issue.code),
        path: captureSafePath(issue.path),
      })),
    });
  if (error instanceof CaptureReadError)
    return new PrivateCaptureError({ ...context, reason: error.reason });
  // Existing profile transport deliberately emits only this fixed source/endpoint message.
  // Match the entire constant, never copy or parse arbitrary error text into the diagnostic.
  for (const endpoint of Endpoint.options) {
    if (
      error instanceof Error &&
      error.message ===
        `Read-only ${context.source} inventory failed at ${endpoint}`
    )
      return new PrivateCaptureError({
        ...context,
        endpoint,
        reason: "read_failed",
      });
  }
  return new PrivateCaptureError({ ...context, reason: knownReason(error) });
}
export async function captureStage<T>(
  context: Context,
  run: () => T | Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw captureDiagnostic(error, context);
  }
}
