import { z } from "zod";
import definition from "tasknotes-macos/scripts/native/official-account/official-verification.protocol.json";

const rule = z.strictObject({
  type: z.enum(["string", "number", "integer", "boolean"]),
  enum: z.array(z.union([z.string(), z.boolean()])).optional(),
  pattern: z.string().optional(),
  minLength: z.number().int().optional(),
  maxLength: z.number().int().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
});
export const verificationProtocol = z
  .strictObject({
    schemaVersion: z.literal(1),
    officialAsarSHA256: z.string().regex(/^[a-f0-9]{64}$/u),
    limits: z.strictObject({
      frameBytes: z.number().int().positive(),
      sessionMs: z.number().int().positive(),
      clockSkewMs: z.number().int().positive(),
      deliveryMs: z.number().int().positive(),
      minimumRemainingMs: z.number().int().positive(),
    }),
    probeCode: z.string().regex(/^\d{6}$/u),
    methodWords: z.strictObject({
      allowedPattern: z.string(),
      forbiddenPattern: z.string(),
    }),
    preparationPhases: z.array(z.string()).nonempty(),
    frameModes: z.record(z.string(), z.string()),
    frames: z.record(z.string(), z.array(z.string())),
    fields: z.record(z.string(), rule),
  })
  .parse(definition);

export function officialTOTPMethodWords(words: string) {
  const { allowedPattern, forbiddenPattern } = verificationProtocol.methodWords;
  return (
    new RegExp(allowedPattern, "i").test(words) &&
    !new RegExp(forbiddenPattern, "is").test(words)
  );
}

function numberSchema(value: z.infer<typeof rule>) {
  let number = z.number();
  if (value.type === "integer") number = number.int();
  if (value.minimum !== undefined) number = number.min(value.minimum);
  if (value.maximum !== undefined) number = number.max(value.maximum);
  return number;
}
function fieldSchema(value: z.infer<typeof rule>): z.ZodType {
  let schema: z.ZodType;
  if (value.type === "string") {
    let text = z.string();
    if (value.minLength !== undefined) text = text.min(value.minLength);
    if (value.maxLength !== undefined) text = text.max(value.maxLength);
    if (value.pattern !== undefined)
      text = text.regex(new RegExp(value.pattern, "u"));
    schema = text;
  } else if (value.type === "boolean") schema = z.boolean();
  else schema = numberSchema(value);
  const values = value.enum;
  return values === undefined
    ? schema
    : schema.refine((candidate) => {
        const parsed = z.union([z.string(), z.boolean()]).safeParse(candidate);
        return parsed.success && values.includes(parsed.data);
      });
}
const schemas = new Map(
  Object.entries(verificationProtocol.frames).map(([frame, fields]) => {
    const properties: Record<string, z.ZodType> = {};
    for (const name of fields) {
      const entry = verificationProtocol.fields[name];
      if (entry === undefined)
        throw new Error("Unsupported official verification protocol");
      properties[name] = fieldSchema(entry);
    }
    return [
      frame,
      z
        .strictObject(properties)
        .refine(
          (v) => ["init", "prepare"].includes(frame) || v["kind"] === frame,
        )
        .refine(
          (v) =>
            verificationProtocol.frameModes[frame] === undefined ||
            v["mode"] === verificationProtocol.frameModes[frame],
        ),
    ] as const;
  }),
);
export function verificationFrame(
  frame: string,
  value: unknown,
): Record<string, unknown> {
  try {
    const schema = schemas.get(frame);
    if (schema === undefined)
      throw new Error("Unknown official verification frame");
    return schema.parse(value);
  } catch {
    throw new Error("Official verification frame rejected");
  }
}
export function verificationWire(frame: string, value: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(
    JSON.stringify(verificationFrame(frame, value)) + "\n",
  );
  if (bytes.length > verificationProtocol.limits.frameBytes)
    throw new Error("Official verification frame exceeded its bound");
  return bytes;
}

export const OfficialVerificationPreparedSchema = z.strictObject({
  program: z.string().startsWith("/").max(2048),
  binarySHA256: z.string().regex(/^[a-f0-9]{64}$/u),
  input: z
    .record(z.string(), z.unknown())
    .transform((value) => verificationFrame("init", value)),
});
export const OfficialVerificationProofSchema = z
  .record(z.string(), z.unknown())
  .transform((value) => verificationFrame("proof", value));

export function requireVerificationProof(
  value: unknown,
  prepared: z.infer<typeof OfficialVerificationPreparedSchema>,
) {
  const proof = OfficialVerificationProofSchema.parse(value);
  for (const key of [
    "runID",
    "configSHA256",
    "challengeID",
    "pid",
    "startSeconds",
    "startMicroseconds",
    "launchDate",
  ]) {
    if (proof[key] !== prepared.input[key])
      throw new Error("Official verification proof binding changed");
  }
  if (
    proof["binarySHA256"] !== prepared.binarySHA256 ||
    proof["cleared"] !== true ||
    proof["submitActionCount"] !== 0 ||
    proof["codeLength"] !== 6
  )
    throw new Error("Official verification proof is incomplete");
  return proof;
}
