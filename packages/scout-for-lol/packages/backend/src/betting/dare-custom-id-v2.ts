import { z } from "zod";
import { BUCKS_INT32_MAX } from "@scout-for-lol/data";
import { MAX_CUSTOM_ID_LENGTH } from "#src/betting/custom-id.ts";

export const DARE_V2_COMPONENT_NAMESPACE = "bbd2";
const VERSION = "1";

const DareIdSchema = z.number().int().positive().max(BUCKS_INT32_MAX);
const RevisionSchema = z.number().int().positive().max(BUCKS_INT32_MAX);

export const DareV2CustomIdSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("intent"), intentId: z.uuid() }),
  z.strictObject({
    kind: z.literal("delete"),
    dareId: DareIdSchema,
    revision: RevisionSchema,
  }),
  z.strictObject({
    kind: z.literal("prepare"),
    dareId: DareIdSchema,
    revision: RevisionSchema,
    action: z.enum(["accept", "decline", "contribute", "cancel"]),
    amount: z.number().int().min(1).max(BUCKS_INT32_MAX).nullable(),
  }),
]);
export type DareV2CustomId = z.infer<typeof DareV2CustomIdSchema>;

function actionCode(
  action: Extract<DareV2CustomId, { kind: "prepare" }>["action"],
): string {
  if (action === "accept") return "a";
  if (action === "decline") return "d";
  if (action === "contribute") return "p";
  return "n";
}

export function formatDareV2CustomId(input: DareV2CustomId): string {
  const parsed = DareV2CustomIdSchema.parse(input);
  const segments = [DARE_V2_COMPONENT_NAMESPACE, VERSION];
  if (parsed.kind === "intent") {
    segments.push("i", parsed.intentId);
  } else if (parsed.kind === "delete") {
    segments.push("x", parsed.dareId.toString(), parsed.revision.toString());
  } else {
    segments.push(
      "q",
      parsed.dareId.toString(),
      parsed.revision.toString(),
      actionCode(parsed.action),
      parsed.amount?.toString() ?? "0",
    );
  }
  const customId = segments.join(":");
  if (customId.length > MAX_CUSTOM_ID_LENGTH) {
    throw new Error("Dare v2 custom ID exceeds Discord's component limit.");
  }
  return customId;
}

function parseAction(code: string | undefined) {
  if (code === "a") return "accept" as const;
  if (code === "d") return "decline" as const;
  if (code === "p") return "contribute" as const;
  if (code === "n") return "cancel" as const;
  return;
}

export function parseDareV2CustomId(raw: string): DareV2CustomId | undefined {
  const segments = raw.split(":");
  if (segments[0] !== DARE_V2_COMPONENT_NAMESPACE || segments[1] !== VERSION) {
    return undefined;
  }
  const kind = segments[2];
  const candidate: unknown =
    kind === "i" && segments.length === 4
      ? { kind: "intent", intentId: segments[3] }
      : kind === "x" && segments.length === 5
        ? {
            kind: "delete",
            dareId: Number(segments[3]),
            revision: Number(segments[4]),
          }
        : kind === "q" && segments.length === 7
          ? {
              kind: "prepare",
              dareId: Number(segments[3]),
              revision: Number(segments[4]),
              action: parseAction(segments[5]),
              amount: Number(segments[6]) === 0 ? null : Number(segments[6]),
            }
          : null;
  const parsed = DareV2CustomIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function isDareV2CustomId(raw: string): boolean {
  return raw.startsWith(`${DARE_V2_COMPONENT_NAMESPACE}:`);
}
