import { z } from "zod";

export const DARE_COMPONENT_NAMESPACE = "dare";
const VERSION = "1";

const DareIdSchema = z.number().int().positive().max(2_147_483_647);
const RevisionSchema = z.number().int().positive().max(2_147_483_647);

export const DareCustomIdSchema = z.discriminatedUnion("kind", [
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
    action: z.enum(["accept", "decline", "cancel"]),
  }),
]);
export type DareCustomId = z.infer<typeof DareCustomIdSchema>;

function actionCode(
  action: Extract<DareCustomId, { kind: "prepare" }>["action"],
): string {
  if (action === "accept") return "a";
  return action === "decline" ? "d" : "n";
}

export function formatDareCustomId(input: DareCustomId): string {
  const parsed = DareCustomIdSchema.parse(input);
  const segments = [DARE_COMPONENT_NAMESPACE, VERSION];
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
    );
  }
  const customId = segments.join(":");
  if (customId.length > 100) {
    throw new Error("Dare custom ID exceeds Discord's component limit.");
  }
  return customId;
}

function parseAction(code: string | undefined) {
  if (code === "a") return "accept" as const;
  if (code === "d") return "decline" as const;
  if (code === "n") return "cancel" as const;
  return;
}

export function parseDareCustomId(raw: string): DareCustomId | undefined {
  const segments = raw.split(":");
  if (segments[0] !== DARE_COMPONENT_NAMESPACE || segments[1] !== VERSION) {
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
        : kind === "q" && segments.length === 6
          ? {
              kind: "prepare",
              dareId: Number(segments[3]),
              revision: Number(segments[4]),
              action: parseAction(segments[5]),
            }
          : null;
  const parsed = DareCustomIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function isDareCustomId(raw: string): boolean {
  return raw.startsWith(`${DARE_COMPONENT_NAMESPACE}:`);
}
