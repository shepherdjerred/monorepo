import {
  generateValidatedObject,
  type LlmRuntime,
} from "@shepherdjerred/llm-runtime";
import { z } from "zod";
import { canonicalWorkKey } from "@shepherdjerred/streambot/discovery/same-work.ts";
import { isBlockedText } from "@shepherdjerred/streambot/moderation/adult-block.ts";
import { VOICE_DECISIONS_MODEL } from "@shepherdjerred/streambot/voice/constants.ts";
import { getOrCreateVoiceDecisionsRuntime } from "@shepherdjerred/streambot/voice/voice-command-router.ts";

const RADIO_LLM_TIMEOUT_MS = 12_000;
const RADIO_LLM_WORKLOAD = "streambot.radio.curate";

const RadioSuggestionsWireSchema = z.strictObject({
  tracks: z.array(
    z.strictObject({
      artist: z.string(),
      title: z.string(),
    }),
  ),
});

export const RadioSuggestionTrackSchema = z.strictObject({
  artist: z.string().min(1).max(120),
  title: z.string().min(1).max(160),
});
export type RadioSuggestionTrack = z.infer<typeof RadioSuggestionTrackSchema>;

const SYSTEM_PROMPT = `You are Streambot's personalized radio curator.
Suggest 6 to 8 real, playable individual songs (artist and song title) tailored to the station seed and listener taste profile.
Rules:
- Return real recordings by real artists, never compilations, full albums, karaoke, or multi-hour mixes.
- Do not repeat tracks already listed in liked tracks or skipped tracks.
- Steer away from skipped tracks and mismatched styles.
- Vary artists across the list unless the seed specifically requests a single artist.`;

export type SuggestRadioTracksInput = {
  readonly apiKey?: string | undefined;
  readonly runtime?: LlmRuntime | undefined;
  readonly seed?: string | undefined;
  readonly topArtists: readonly string[];
  readonly topTracks: readonly string[];
  readonly recentQueries: readonly string[];
  readonly skippedTitles: readonly string[];
  readonly excludeWorkKeys?: ReadonlySet<string> | undefined;
  readonly limit?: number | undefined;
  readonly signal?: AbortSignal | undefined;
};

function buildCuratorPrompt(input: SuggestRadioTracksInput): string {
  const sections: string[] = [];
  if (input.seed !== undefined && input.seed.trim() !== "") {
    sections.push(`Station seed: ${input.seed.trim().slice(0, 200)}`);
  }
  if (input.topArtists.length > 0) {
    sections.push(`Liked artists: ${input.topArtists.slice(0, 8).join("; ")}`);
  }
  if (input.topTracks.length > 0) {
    sections.push(
      `Representative liked songs (do not repeat verbatim): ${input.topTracks.slice(0, 8).join("; ")}`,
    );
  }
  if (input.recentQueries.length > 0) {
    sections.push(
      `Recent listener requests: ${input.recentQueries.slice(0, 6).join("; ")}`,
    );
  }
  if (input.skippedTitles.length > 0) {
    sections.push(
      `Recently skipped (avoid these): ${input.skippedTitles.slice(0, 8).join("; ")}`,
    );
  }
  if (sections.length === 0) {
    sections.push(
      "Listener taste profile is empty; suggest an accessible, crowd-pleasing mix of classic and modern standout songs.",
    );
  }
  return sections.join("\n");
}

/**
 * Curate 6–8 `{ artist, title }` suggestions using `LlmRuntime`.
 * Never logs Discord IDs, user queries, or track lists; returns `[]` gracefully on error/timeout.
 */
export async function suggestRadioTracks(
  input: SuggestRadioTracksInput,
): Promise<RadioSuggestionTrack[]> {
  const runtime =
    input.runtime ??
    (input.apiKey === undefined || input.apiKey.trim() === ""
      ? null
      : getOrCreateVoiceDecisionsRuntime({ apiKey: input.apiKey }));
  if (runtime === null) return [];

  const timeoutSignal = AbortSignal.timeout(RADIO_LLM_TIMEOUT_MS);
  const abortSignal =
    input.signal === undefined
      ? timeoutSignal
      : AbortSignal.any([input.signal, timeoutSignal]);

  try {
    const result = await generateValidatedObject(runtime, {
      model: VOICE_DECISIONS_MODEL,
      workload: RADIO_LLM_WORKLOAD,
      schema: RadioSuggestionsWireSchema,
      schemaName: "radio_suggestions",
      system: SYSTEM_PROMPT,
      prompt: buildCuratorPrompt(input),
      maxOutputTokens: 600,
      abortSignal,
    });

    const maxItems = Math.min(8, Math.max(1, input.limit ?? 8));
    const excluded = input.excludeWorkKeys ?? new Set<string>();
    const seen = new Set<string>();
    const tracks: RadioSuggestionTrack[] = [];

    for (const raw of result.object.tracks) {
      const parsed = RadioSuggestionTrackSchema.safeParse({
        artist: raw.artist.trim(),
        title: raw.title.trim(),
      });
      if (!parsed.success) continue;
      const { artist, title } = parsed.data;
      if (isBlockedText(artist) || isBlockedText(title)) continue;
      const fullKey = canonicalWorkKey(`${artist} - ${title}`);
      const titleKey = canonicalWorkKey(title);
      if (
        fullKey === "" ||
        seen.has(fullKey) ||
        excluded.has(fullKey) ||
        (titleKey !== "" && excluded.has(titleKey))
      ) {
        continue;
      }
      seen.add(fullKey);
      tracks.push(parsed.data);
      if (tracks.length >= maxItems) break;
    }
    return tracks;
  } catch {
    return [];
  }
}
