import { randomFillSync } from "node:crypto";
import { PUBLIC_BUCKET, PUBLIC_HOST } from "#lib/s3/assets.ts";
import { AGENT_SHARE_PROFILE, UploadSetupError } from "#lib/s3/upload.ts";

/**
 * Naming, targets, and error text for `toolkit share`. The command itself
 * lives in `commands/share.ts`.
 */

export type ShareVisibility = "public" | "private";

export type ShareTarget = {
  bucket: string;
  /** Origin that serves the bucket. */
  host: string;
  /** Who can open the URLs. */
  audience: string;
};

/** Bucket served only on the tailnet at `https://private.tailnet-1a49.ts.net`. */
export const PRIVATE_BUCKET = "private-sjer-red";
export const PRIVATE_HOST = "https://private.tailnet-1a49.ts.net";

export const SHARE_TARGETS: Readonly<Record<ShareVisibility, ShareTarget>> = {
  public: {
    bucket: PUBLIC_BUCKET,
    host: PUBLIC_HOST,
    audience: "anyone on the internet",
  },
  private: {
    bucket: PRIVATE_BUCKET,
    host: PRIVATE_HOST,
    audience: "devices on the tailnet",
  },
};

/** Days before `share/tmp/` objects expire (the bucket lifecycle rule). */
export const SHARE_TMP_EXPIRY = "30d";

/** RFC 4648 base32 alphabet, lowercased: a-z then 2-7. */
const BASE32_ALPHABET = Array.from({ length: 32 }, (_unused, index) =>
  index < 26 ? String.fromCodePoint(97 + index) : String(index - 24),
).join("");
const SHARE_ID_LENGTH = 12;

/** 12 random lowercase base32 characters (60 bits, uniform). */
export function randomShareId(): string {
  const bytes = new Uint8Array(SHARE_ID_LENGTH);
  randomFillSync(bytes);
  // 256 is a multiple of 32, so `byte % 32` is unbiased.
  return Array.from(
    bytes,
    (byte) => BASE32_ALPHABET[byte % BASE32_ALPHABET.length],
  ).join("");
}

/** `share/{tmp|keep}/<yyyy-mm-dd, UTC>/<id>`; the name is appended by callers. */
export function shareKeyPrefix(options: {
  keep: boolean;
  now: Date;
  id: string;
}): string {
  const date = options.now.toISOString().slice(0, 10);
  return `share/${options.keep ? "keep" : "tmp"}/${date}/${options.id}`;
}

/** Reason a `--name` cannot be a single object-key segment, if any. */
export function invalidNameReason(name: string): string | undefined {
  if (name.length === 0) return "must not be empty";
  if (name === "." || name === "..") return "must not be '.' or '..'";
  if (/[/\\]/.test(name)) {
    return "must be a single path segment without slashes or backslashes";
  }
  const hasControlCharacter = name.split("").some((_unit, index) => {
    const code = name.codePointAt(index) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
  return hasControlCharacter
    ? "must not contain control characters"
    : undefined;
}

const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  [
    /("?(?:SecretAccessKey|AccessKeyId|SessionToken|aws_secret_access_key|aws_access_key_id|aws_session_token)"?\s*[:=]\s*)"?[^\s",}]+"?/gi,
    "$1[redacted]",
  ],
  [/(Signature=)[0-9a-f]{16,}/gi, "$1[redacted]"],
  [/(Credential=)[^/\s,&]+/gi, "$1[redacted]"],
  [/(X-Amz-Security-Token=)[^\s&]+/gi, "$1[redacted]"],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted]"],
];

/** Mask anything in error text that looks like an AWS key, token, or signature. */
export function redactSecrets(text: string): string {
  return REDACTIONS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}

const PROFILE_HINT = (profile: string): string =>
  profile === AGENT_SHARE_PROFILE
    ? `Run 'chezmoi apply ~/.aws/config' to render the '${AGENT_SHARE_PROFILE}' profile, then check that 'toolkit aws credential ${AGENT_SHARE_PROFILE} >/dev/null' exits 0.`
    : `Check that profile '${profile}' exists in ~/.aws/config with an endpoint_url and working credentials.`;

function errorFields(error: unknown): {
  name: string;
  message: string;
  status: number | undefined;
} {
  if (!(error instanceof Error)) {
    return { name: "Error", message: String(error), status: undefined };
  }
  const metadata: unknown = Reflect.get(error, "$metadata");
  const status: unknown =
    typeof metadata === "object" && metadata !== null
      ? Reflect.get(metadata, "httpStatusCode")
      : undefined;
  return {
    name: error.name,
    message: error.message,
    status: typeof status === "number" ? status : undefined,
  };
}

/** SeaweedFS answers AccessDenied for a bucket that does not exist yet. */
function deniedBucketNote(visibility: ShareVisibility): string {
  return visibility === "private"
    ? `; SeaweedFS also denies access while '${PRIVATE_BUCKET}' has not been created, so the homelab release that adds it may be pending`
    : "";
}

/**
 * One-line, secret-free explanation of an upload failure that names the fix
 * when there is one.
 */
export function describeShareError(
  error: unknown,
  context: { profile: string; visibility: ShareVisibility },
): string {
  const target = SHARE_TARGETS[context.visibility];
  const { name, message, status } = errorFields(error);
  if (error instanceof UploadSetupError) {
    return `${redactSecrets(message)}. ${PROFILE_HINT(context.profile)}`;
  }
  if (
    /credential/i.test(name) ||
    /could not (?:resolve|load) credentials|credential_process|config profile/i.test(
      message,
    )
  ) {
    return `could not load credentials for AWS profile '${context.profile}'. ${PROFILE_HINT(context.profile)}`;
  }
  if (name === "NoSuchBucket") {
    return context.visibility === "private"
      ? `bucket '${target.bucket}' does not exist yet; the private share bucket is created by the homelab release that adds it. Use 'share public' if the file may be world-readable.`
      : `bucket '${target.bucket}' does not exist`;
  }
  return name === "AccessDenied" || status === 403
    ? `access denied writing to '${target.bucket}' with AWS profile '${context.profile}'. The '${AGENT_SHARE_PROFILE}' identity may write only 'public-sjer-red' and '${PRIVATE_BUCKET}'${deniedBucketNote(context.visibility)}.`
    : redactSecrets(`${name}: ${message}`);
}
