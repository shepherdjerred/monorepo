import type {
  VoiceCorpusAugmentation,
  VoiceCorpusEntry,
} from "@shepherdjerred/streambot/voice/corpus-schema.ts";

export const OPENAI_TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;

export const APPLE_TTS_VOICES = [
  "Aman",
  "Daniel",
  "Karen",
  "Kathy",
  "Moira",
  "Rishi",
  "Samantha",
  "Tara",
  "Tessa",
  "Fred",
] as const;

const STYLES = ["neutral", "quiet", "hurried", "distant", "hesitant"] as const;
const APPLE_RATES = [130, 180, 240] as const;

const POSITIVE_COMMANDS = [
  "Hey Streambot, play Spirited Away from local.",
  "Hey Streambot, play Take On Me from YouTube.",
  "Hey Streambot, play The Matrix.",
  "Hey Streambot, play Missing Movie from local.",
  "Hey Streambot, skip this.",
  "Hey Streambot, stop playback.",
  "Hey Streambot, seek to forty two minutes.",
  "Hey Streambot, go back thirty seconds.",
  "Hey Streambot, set volume to sixty percent.",
  "Hey Streambot, loop this track.",
  "Hey Streambot, loop the queue.",
  "Hey Streambot, turn looping off.",
  "Hey Streambot, shuffle the queue.",
  "Hey Streambot, what is playing now?",
  "Hey Streambot, what is in the queue?",
  "Hey Streambot, play Moonlight from local.",
  "Hey Streambot, play Moonlight from YouTube.",
  "Hey Streambot, play The Grand Budapest Hotel next.",
  "Hey Streambot, play it.",
  "Hey Streambot, play https colon slash slash example dot com.",
  "Hey Streambot, skip and shuffle.",
] as const;

const NEAR_MATCHES = [
  "Hey streamer, play the next thing.",
  "Okay Streambot, can you hear me?",
  "Hey dream bot, turn it up.",
  "Hey stream box, play a movie.",
  "They streamed a bot playing music.",
  "I said hey to the stream bot yesterday.",
  "Hey Steam bot, skip that.",
  "The stream bought another camera.",
  "Hey Stream, stop the bot.",
  "A streamboat floated by the dock.",
] as const;

const ORDINARY_SPEECH = [
  "Could somebody turn the television down?",
  "I think the next episode starts in ten minutes.",
  "What movie should we watch tonight?",
  "The weather is surprisingly pleasant today.",
  "Please add popcorn to the shopping list.",
  "This soundtrack has a very quiet beginning.",
  "I need to leave after this scene finishes.",
  "Did you remember to close the garage door?",
  "The projector looks much brighter now.",
  "Let us take a short break before continuing.",
] as const;

export type VoiceCorpusRecipe = Omit<
  VoiceCorpusEntry,
  "durationMs" | "speechEndMs" | "packetCount" | "sha256"
>;

function cycle<T>(values: readonly T[], index: number): T {
  const value = values[index % values.length];
  if (value === undefined)
    throw new Error("Cannot cycle an empty corpus value list");
  return value;
}

function augmentation(
  kind: VoiceCorpusAugmentation["kind"],
  options: Partial<Omit<VoiceCorpusAugmentation, "kind">> = {},
): VoiceCorpusAugmentation {
  return {
    kind,
    snrDb: options.snrDb ?? null,
    packetLossPercent: options.packetLossPercent ?? 0,
    echo: options.echo ?? false,
    overlap: options.overlap ?? false,
  };
}

type SpeechRecipeOptions = {
  readonly index: number;
  readonly group: string;
  readonly category: VoiceCorpusRecipe["category"];
  readonly expected: VoiceCorpusRecipe["expected"];
  readonly text: string;
  readonly effect: VoiceCorpusAugmentation;
};

function speechRecipe(options: SpeechRecipeOptions): VoiceCorpusRecipe {
  const { index } = options;
  const provider = index % 2 === 0 ? "openai" : "apple";
  const providerIndex = Math.floor(index / 2);
  const voice =
    provider === "openai"
      ? cycle(OPENAI_TTS_VOICES, providerIndex)
      : cycle(APPLE_TTS_VOICES, providerIndex);
  const id = `${options.group}-${String(index + 1).padStart(3, "0")}`;
  return {
    id,
    file: `clips/${id}.dopus`,
    expected: options.expected,
    category: options.category,
    provider,
    model: provider === "openai" ? "gpt-4o-mini-tts" : "macos-say",
    voice,
    style: cycle(STYLES, index),
    rateWpm: provider === "apple" ? cycle(APPLE_RATES, providerIndex) : null,
    text: options.text,
    augmentation: options.effect,
    split: index % 5 === 0 ? "holdout" : "tuning",
    aiGenerated: true,
  };
}

function cleanPositiveRecipes(): VoiceCorpusRecipe[] {
  return Array.from({ length: 160 }, (_, index) =>
    speechRecipe({
      index,
      group: "clean-positive",
      category: "clean-positive",
      expected: "wake",
      text: cycle(POSITIVE_COMMANDS, index),
      effect: augmentation(index % 4 === 0 ? "moderate" : "clean"),
    }),
  );
}

function stressPositiveRecipes(): VoiceCorpusRecipe[] {
  const snrValues = [20, 10, 5, 0] as const;
  return Array.from({ length: 80 }, (_, index) =>
    speechRecipe({
      index,
      group: "stress-positive",
      category: "stress-positive",
      expected: "wake",
      text: cycle(POSITIVE_COMMANDS, index),
      effect: augmentation(
        index % 3 === 0 ? "packet-loss" : index % 2 === 0 ? "echo" : "noise",
        {
          snrDb: cycle(snrValues, index),
          packetLossPercent: index % 3 === 0 ? 5 : 0,
          echo: index % 2 === 0,
        },
      ),
    }),
  );
}

function nearMatchRecipes(): VoiceCorpusRecipe[] {
  return Array.from({ length: 60 }, (_, index) =>
    speechRecipe({
      index,
      group: "near-match-negative",
      category: "near-match-negative",
      expected: "no-wake",
      text: cycle(NEAR_MATCHES, index),
      effect: augmentation(index % 3 === 0 ? "moderate" : "clean"),
    }),
  );
}

function ordinaryNegativeRecipes(): VoiceCorpusRecipe[] {
  return Array.from({ length: 60 }, (_, index) =>
    speechRecipe({
      index,
      group: "ordinary-negative",
      category: "ordinary-negative",
      expected: "no-wake",
      text: cycle(ORDINARY_SPEECH, index),
      effect: augmentation(index % 4 === 0 ? "noise" : "clean", {
        snrDb: index % 4 === 0 ? 20 : null,
      }),
    }),
  );
}

function backgroundNegativeRecipe(index: number): VoiceCorpusRecipe {
  const id = `background-negative-${String(index + 1).padStart(3, "0")}`;
  if (index >= 32) {
    return {
      id,
      file: `clips/${id}.dopus`,
      expected: "no-wake",
      category: "background-negative",
      provider: "procedural",
      model: "deterministic-tones-v1",
      voice: "generated-tones",
      style: "neutral",
      rateWpm: null,
      text: "",
      augmentation: augmentation("music-like"),
      split: index % 5 === 0 ? "holdout" : "tuning",
      aiGenerated: true,
    };
  }
  return speechRecipe({
    index,
    group: "background-negative",
    category: "background-negative",
    expected: "no-wake",
    text: `${cycle(ORDINARY_SPEECH, index)} ${cycle(ORDINARY_SPEECH, index + 3)}`,
    effect: augmentation("overlap", { overlap: true, snrDb: 20 }),
  });
}

export function expandVoiceCorpusRecipes(): VoiceCorpusRecipe[] {
  return [
    ...cleanPositiveRecipes(),
    ...stressPositiveRecipes(),
    ...nearMatchRecipes(),
    ...ordinaryNegativeRecipes(),
    ...Array.from({ length: 40 }, (_, index) =>
      backgroundNegativeRecipe(index),
    ),
  ];
}
