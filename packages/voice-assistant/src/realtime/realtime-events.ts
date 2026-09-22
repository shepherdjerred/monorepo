import { z } from "zod";

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
// "conversation.item.added"; the SDK forwards the raw name. Matching only the old
// name left the command-item wait hanging until the transaction timeout, so no
// command ever ran. Accept both so the turn works across API revisions.
export const ConversationItemCreatedEventSchema = z.object({
  type: z.enum(["conversation.item.added", "conversation.item.created"]),
  item: z.object({ id: z.string().min(1) }),
});

export const OutputAudioTranscriptEventSchema = z.object({
  type: z.enum([
    "response.output_audio_transcript.done",
    "response.audio_transcript.done",
  ]),
  transcript: z.string(),
});

export type CompletedTranscription = z.infer<
  typeof TranscriptionCompletedEventSchema
>;
