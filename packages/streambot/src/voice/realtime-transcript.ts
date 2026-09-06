import { z } from "zod";
import { voiceTranscriptionUsageTotal } from "@shepherdjerred/streambot/observability/metrics.ts";

export const TranscriptionCompletedEventSchema = z.object({
  type: z.literal("conversation.item.input_audio_transcription.completed"),
  item_id: z.string().min(1),
  transcript: z.string(),
  usage: z.union([
    z.object({
      type: z.literal("tokens"),
      input_tokens: z.number().nonnegative(),
      output_tokens: z.number().nonnegative(),
      total_tokens: z.number().nonnegative(),
      input_token_details: z
        .object({
          audio_tokens: z.number().nonnegative().optional(),
          text_tokens: z.number().nonnegative().optional(),
        })
        .optional(),
    }),
    z.object({
      type: z.literal("duration"),
      seconds: z.number().nonnegative(),
    }),
  ]),
});

export const TranscriptionFailedEventSchema = z.object({
  type: z.literal("conversation.item.input_audio_transcription.failed"),
  error: z.unknown().optional(),
});

export const ConversationItemDeletedEventSchema = z.object({
  type: z.literal("conversation.item.deleted"),
  item_id: z.string().min(1),
});

// The Realtime GA API renamed this event from "conversation.item.created" to
// "conversation.item.added"; the SDK forwards the raw name. Accept both names.
export const ConversationItemCreatedEventSchema = z.object({
  type: z.enum(["conversation.item.added", "conversation.item.created"]),
  item: z.object({ id: z.string().min(1) }),
});

export type CompletedTranscription = z.infer<
  typeof TranscriptionCompletedEventSchema
>;

export type VerifiedWakeTranscript = {
  readonly normalized: string;
  readonly command: string;
};

export function normalizeTranscript(transcript: string): string {
  return transcript
    .toLocaleLowerCase("en-US")
    .replaceAll(/[^a-z0-9\s]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/** Strict final wake gate. The phrase must be the leading normalized words. */
export function verifyWakeTranscript(
  transcript: string,
): VerifiedWakeTranscript | null {
  const normalized = normalizeTranscript(transcript);
  for (const prefix of ["hey streambot", "hey stream bot", "hey streamboat"]) {
    if (normalized === prefix) return { normalized, command: "" };
    if (normalized.startsWith(`${prefix} `)) {
      return { normalized, command: normalized.slice(prefix.length + 1) };
    }
  }
  return null;
}

export function recordTranscriptionUsage(
  usage: CompletedTranscription["usage"],
): void {
  if (usage.type === "duration") {
    voiceTranscriptionUsageTotal.inc(
      { unit: "seconds", direction: "input" },
      usage.seconds,
    );
    return;
  }
  voiceTranscriptionUsageTotal.inc(
    { unit: "tokens", direction: "input" },
    usage.input_tokens,
  );
  voiceTranscriptionUsageTotal.inc(
    { unit: "tokens", direction: "output" },
    usage.output_tokens,
  );
}
