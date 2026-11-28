import { z } from "zod";

/**
 * How a variant flag's string travels on the wire.
 *
 * - `string`: the stored string is the value.
 * - `number`: the stored string is a JSON number literal (`"900"`, `"0.5"`).
 * - `json`: the stored string is JSON text (`"[]"`, `"{\"a\":1}"`).
 */
export type VariantEncoding = "string" | "number" | "json";

/** One validation failure. `path` is a JSON Pointer into the decoded value; `""` is the whole value. */
export type VariantValueIssue = {
  readonly path: string;
  readonly message: string;
};

export type VariantValueValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly VariantValueIssue[] };

export type SpecDecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly VariantValueIssue[] };

export type SpecEncodeResult =
  | { readonly ok: true; readonly raw: string }
  | { readonly ok: false; readonly issues: readonly VariantValueIssue[] };

/**
 * A variant flag's wire encoding paired with the Zod schema of its decoded
 * value, plus the codec built from them. Decoded schemas carry no transforms,
 * so `z.toJSONSchema` can describe them to editors; `.default()` on object
 * fields is allowed and fills omitted settings the way the consumer did.
 *
 * `O` and `I` are the decoded output and input types. The codec methods are
 * typed per spec so keyed lookups stay precise without assertions.
 */
export type VariantValueSpec<O = unknown, I = never> = {
  readonly encoding: VariantEncoding;
  readonly schema: z.ZodType;
  /** Decodes a wire string, reporting every issue instead of throwing. */
  readonly decode: (raw: string) => SpecDecodeResult<O>;
  /**
   * Validates a typed value and encodes it canonically: the string itself,
   * `String(number)`, or compact `JSON.stringify` of the validated output
   * (object defaults materialized).
   */
  readonly encode: (value: I) => SpecEncodeResult;
  /** A config-layer schema producing the decoded value; see `liftConsumerInput`. */
  readonly consumerSchema: () => z.ZodType<O>;
};

/** RFC 8259 number grammar: no whitespace, signs, hex, `Infinity`, or `NaN`. */
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/iu;

function escapePointerSegment(segment: PropertyKey): string {
  return String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
}

export function issuePointer(path: readonly PropertyKey[]): string {
  return path.map((segment) => `/${escapePointerSegment(segment)}`).join("");
}

function zodIssues(error: z.ZodError): VariantValueIssue[] {
  return error.issues.map((issue) => ({
    path: issuePointer(issue.path),
    message: issue.message,
  }));
}

type WireResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

function decodeNumber(raw: string): WireResult {
  if (!JSON_NUMBER.test(raw)) {
    return {
      ok: false,
      message: `Expected a decimal number, got ${JSON.stringify(raw)}`,
    };
  }
  const value = Number(raw);
  return Number.isFinite(value)
    ? { ok: true, value }
    : {
        ok: false,
        message: `Expected a finite number, got ${JSON.stringify(raw)}`,
      };
}

function decodeJson(raw: string): WireResult {
  try {
    const value: unknown = JSON.parse(raw);
    return { ok: true, value };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "parse failed";
    return { ok: false, message: `Expected JSON text: ${detail}` };
  }
}

function decodeWire(encoding: VariantEncoding, raw: string): WireResult {
  switch (encoding) {
    case "string": {
      return { ok: true, value: raw };
    }
    case "number": {
      return decodeNumber(raw);
    }
    case "json": {
      return decodeJson(raw);
    }
  }
}

function encodeWire(
  encoding: VariantEncoding,
  decoded: unknown,
): SpecEncodeResult {
  if (encoding === "json") return { ok: true, raw: JSON.stringify(decoded) };
  if (encoding === "string" && typeof decoded === "string") {
    return { ok: true, raw: decoded };
  }
  if (encoding === "number" && typeof decoded === "number") {
    return { ok: true, raw: String(decoded) };
  }
  return {
    ok: false,
    issues: [{ path: "", message: `Expected a ${encoding} value` }],
  };
}

/**
 * Lifts what a config layer hands a key today into the decoded domain:
 *
 * - `string`: the string, unchanged.
 * - `number`: a number (the flag layer's `"number"` kind and code defaults)
 *   or a decimal string (env layers and `"string"`-kind reads).
 * - `json`: JSON text (flag, env, and string defaults) or an already-decoded
 *   value (typed code defaults).
 */
function liftConsumerInput(encoding: VariantEncoding, value: unknown) {
  if (typeof value !== "string" || encoding === "string") {
    return { ok: true as const, value };
  }
  return encoding === "number" ? decodeNumber(value) : decodeJson(value);
}

function buildSpec<S extends z.ZodType>(
  encoding: VariantEncoding,
  schema: S,
): VariantValueSpec<z.output<S>, z.input<S>> {
  return {
    encoding,
    schema,
    decode(raw) {
      const wire = decodeWire(encoding, raw);
      if (!wire.ok) {
        return { ok: false, issues: [{ path: "", message: wire.message }] };
      }
      const parsed = schema.safeParse(wire.value);
      return parsed.success
        ? { ok: true, value: parsed.data }
        : { ok: false, issues: zodIssues(parsed.error) };
    },
    encode(value) {
      const parsed = schema.safeParse(value);
      return parsed.success
        ? encodeWire(encoding, parsed.data)
        : { ok: false, issues: zodIssues(parsed.error) };
    },
    consumerSchema() {
      return z
        .unknown()
        .transform((value, context): unknown => {
          const lifted = liftConsumerInput(encoding, value);
          if (lifted.ok) return lifted.value;
          context.addIssue({ code: "custom", message: lifted.message });
          return z.NEVER;
        })
        .pipe(schema);
    },
  };
}

export function variantString<S extends z.ZodType<string, string>>(
  schema: S,
): VariantValueSpec<z.output<S>, z.input<S>> {
  return buildSpec("string", schema);
}

export function variantNumber<S extends z.ZodType<number, number>>(
  schema: S,
): VariantValueSpec<z.output<S>, z.input<S>> {
  return buildSpec("number", schema);
}

export function variantJson<S extends z.ZodType>(
  schema: S,
): VariantValueSpec<z.output<S>, z.input<S>> {
  return buildSpec("json", schema);
}

/** JSON Schema (draft 2020-12) of the decoded value an editor writes. */
export function jsonSchemaForSpec(
  spec: Pick<VariantValueSpec, "schema">,
): Record<string, unknown> {
  return z.toJSONSchema(spec.schema, {
    io: "input",
    target: "draft-2020-12",
  });
}

/* ------------------------------------------------------------------------ */
/* Shared decoded-value schemas                                              */
/* ------------------------------------------------------------------------ */

/** A model identifier: no whitespace, at most 200 characters. */
export const ModelIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^\S+$/u, "Model id must not contain whitespace");

/** The JSON Schema keyword that carries a model-id flag's `ModelRoute`. */
export const MODEL_ROUTE_KEYWORD = "x-model-route";

/**
 * A model capability a consumer asserts before calling: the catalog's
 * `capabilities.tools` / `capabilities.structuredOutputs` booleans, or
 * `imageInput` for `"image"` in `capabilities.inputModalities`.
 */
export const ModelCapabilityRequirementSchema = z.enum([
  "tools",
  "structuredOutputs",
  "imageInput",
]);
export type ModelCapabilityRequirement = z.infer<
  typeof ModelCapabilityRequirementSchema
>;

/**
 * The `@shepherdjerred/llm-models` route a model-id flag's consumer resolves:
 * a native provider endpoint (with any capabilities it asserts), or the Codex
 * or Claude Agent SDK route. Editors use it to offer catalog models that
 * route; the registry still accepts any `ModelIdSchema` string, because the
 * catalog lives outside this package.
 */
export const ModelRouteSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("native"),
    endpoint: z.enum(["language", "embedding", "image", "decisions"]),
    requires: z.array(ModelCapabilityRequirementSchema).min(1).optional(),
  }),
  z.strictObject({ kind: z.literal("codexSdk") }),
  z.strictObject({ kind: z.literal("claudeAgentSdk") }),
]);
export type ModelRoute = z.infer<typeof ModelRouteSchema>;

/**
 * `ModelIdSchema` tagged with the route its consumer needs. The tag is JSON
 * Schema metadata (`x-model-route`) and does not change what parses.
 */
export function modelIdFor(route: ModelRoute) {
  return ModelIdSchema.meta({
    [MODEL_ROUTE_KEYWORD]: ModelRouteSchema.parse(route),
  });
}

/** A Discord snowflake as decimal digits. */
export const SnowflakeSchema = z.string().regex(/^\d{1,25}$/u);

export const EmailSchema = z.email();

const EMAIL_BODY = z.regexes.email.source
  .replace(/^\^/u, "")
  .replace(/\$$/u, "");
/** `@shepherdjerred/ops-model` `DISPLAY_NAME_PATTERN`, without trailing whitespace. */
const DISPLAY_NAME = String.raw`[A-Za-z0-9](?:[\w .,:&+/-]{0,61}[\w.,:&+/-])?`;

/**
 * A bare email or `Display Name <email>`, mirroring
 * `@shepherdjerred/ops-model` `MailboxAddressSchema` without its trim: stored
 * values carry no surrounding whitespace.
 */
export const MailboxSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(
    new RegExp(`^(?:${EMAIL_BODY}|${DISPLAY_NAME} <${EMAIL_BODY}>)$`, "u"),
    "Expected an email address or `Display Name <email>`",
  );

/** A comma-separated list whose entries each match `entry`; optional spaces follow commas. */
export function commaListSchema(entry: string, message: string) {
  return z
    .string()
    .regex(
      new RegExp(String.raw`^(?:${entry})(?:,\s*(?:${entry}))*$`, "u"),
      message,
    );
}
