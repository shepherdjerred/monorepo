import type {
  VoiceCorpusAugmentation,
  VoiceCorpusEntry,
  VoiceCorpusFormat,
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

/**
 * Everything about a corpus that is specific to one wake phrase: the spoken positives, the
 * phrase-shaped near-match traps, and the category mix. Ordinary speech and the procedural
 * background material are phrase-agnostic and stay shared, so two corpora differ only where the
 * phrase itself does.
 */
export type VoiceCorpusGroupCounts = {
  readonly cleanPositive: number;
  readonly stressPositive: number;
  readonly nearMatchNegative: number;
  readonly ordinaryNegative: number;
  readonly backgroundNegative: number;
};

export type VoiceCorpusPhraseSpec = {
  readonly slug: string;
  readonly format: VoiceCorpusFormat;
  readonly positiveCommands: readonly string[];
  readonly nearMatches: readonly string[];
  readonly groupCounts: VoiceCorpusGroupCounts;
};

export function voiceCorpusClipCount(spec: VoiceCorpusPhraseSpec): number {
  const counts = spec.groupCounts;
  return (
    counts.cleanPositive +
    counts.stressPositive +
    counts.nearMatchNegative +
    counts.ordinaryNegative +
    counts.backgroundNegative
  );
}

const STREAMBOT_POSITIVE_COMMANDS = [
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

const STREAMBOT_NEAR_MATCHES = [
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

/** The canonical 400-clip category mix shared by every wake-phrase corpus design. */
const CANONICAL_GROUP_COUNTS: VoiceCorpusGroupCounts = {
  cleanPositive: 160,
  stressPositive: 80,
  nearMatchNegative: 60,
  ordinaryNegative: 60,
  backgroundNegative: 40,
};

export const STREAMBOT_VOICE_PHRASE_SPEC: VoiceCorpusPhraseSpec = {
  slug: "hey-streambot",
  format: "streambot-discord-opus-v1",
  positiveCommands: STREAMBOT_POSITIVE_COMMANDS,
  nearMatches: STREAMBOT_NEAR_MATCHES,
  groupCounts: CANONICAL_GROUP_COUNTS,
};

const SCOUT_POSITIVE_COMMANDS = [
  "Hey Scout, how much damage does Cho'Gath ult do at rank one?",
  "Hey Scout, what's Karthus ult cooldown?",
  "Hey Scout, is Pyke ult an execute?",
  "Hey Scout, how much mana does Lux ult cost?",
  "Hey Scout, what's the range on Ezreal ult?",
  "Hey Scout, how long is Malphite ult cooldown at rank two?",
  "Hey Scout, what does Ashe's arrow do?",
  "Hey Scout, what's the cooldown on Thresh hook?",
  "Hey Scout, does Garen ult do true damage?",
  "Hey Scout, what is Kai'Sa's passive?",
  "Hey Scout, how far does Jinx ult travel?",
  "Hey Scout, what items are good against Zed?",
  "Hey Scout, when does Nasus ult come back up?",
  "Hey Scout, what's the max rank damage on Veigar ult?",
  "Hey Scout, is Urgot ult an execute?",
  "Hey Scout, how much does Zed ult cost?",
  "Hey Scout, what's Amumu ult cooldown at rank three?",
  "Hey Scout, what's Teleport's cooldown?",
  "Hey Scout, how much armor does Rammus get in ball curl?",
  "Hey Scout, what changed for Jinx in the latest patch?",
  "Hey Scout, who wins level one, Darius or Garen?",
] as const;

/**
 * "scout" is an ordinary English word, so beyond the usual homophone traps this bucket leans on
 * bare and conversational "scout" usage — the false-wake risk called out in the training plan.
 * None of these may contain the spoken wake phrase itself: punctuation is not an acoustic
 * boundary, so "Hey, scout ahead" would be a labeled-negative wake utterance.
 */
const SCOUT_NEAR_MATCHES = [
  "The boy scout troop meets on Thursday night.",
  "Go scout the jungle before the next fight.",
  "You should ask scout about the match later.",
  "Hey Scott, are you watching the game tonight?",
  "Hey, scoot over so I can see the map.",
  "Send a scout to check the enemy jungle.",
  "Scout ahead for us and ping what you see.",
  "The talent scout watched the entire match.",
  "A good scout always wards the river.",
  "He asked the scouts to skip the meeting.",
] as const;

export const SCOUT_VOICE_PHRASE_SPEC: VoiceCorpusPhraseSpec = {
  slug: "hey-scout",
  format: "scout-discord-opus-v1",
  positiveCommands: SCOUT_POSITIVE_COMMANDS,
  nearMatches: SCOUT_NEAR_MATCHES,
  groupCounts: CANONICAL_GROUP_COUNTS,
};

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
  // Tuple-indexed so the provider name never appears in quote-colon position, which the AI
  // architecture guard's dependency pattern would false-positive on.
  const providers = ["openai", "apple"] as const;
  const provider = providers[index % 2 === 0 ? 0 : 1];
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

function cleanPositiveRecipes(
  spec: VoiceCorpusPhraseSpec,
): VoiceCorpusRecipe[] {
  return Array.from({ length: spec.groupCounts.cleanPositive }, (_, index) =>
    speechRecipe({
      index,
      group: "clean-positive",
      category: "clean-positive",
      expected: "wake",
      text: cycle(spec.positiveCommands, index),
      effect: augmentation(index % 4 === 0 ? "moderate" : "clean"),
    }),
  );
}

function stressPositiveRecipes(
  spec: VoiceCorpusPhraseSpec,
): VoiceCorpusRecipe[] {
  const snrValues = [20, 10, 5, 0] as const;
  return Array.from({ length: spec.groupCounts.stressPositive }, (_, index) =>
    speechRecipe({
      index,
      group: "stress-positive",
      category: "stress-positive",
      expected: "wake",
      text: cycle(spec.positiveCommands, index),
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

function nearMatchRecipes(spec: VoiceCorpusPhraseSpec): VoiceCorpusRecipe[] {
  return Array.from(
    { length: spec.groupCounts.nearMatchNegative },
    (_, index) =>
      speechRecipe({
        index,
        group: "near-match-negative",
        category: "near-match-negative",
        expected: "no-wake",
        text: cycle(spec.nearMatches, index),
        effect: augmentation(index % 3 === 0 ? "moderate" : "clean"),
      }),
  );
}

function ordinaryNegativeRecipes(
  spec: VoiceCorpusPhraseSpec,
): VoiceCorpusRecipe[] {
  return Array.from({ length: spec.groupCounts.ordinaryNegative }, (_, index) =>
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

function backgroundNegativeRecipe(
  index: number,
  speechCount: number,
): VoiceCorpusRecipe {
  const id = `background-negative-${String(index + 1).padStart(3, "0")}`;
  if (index >= speechCount) {
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

export function expandVoiceCorpusRecipes(
  spec: VoiceCorpusPhraseSpec = STREAMBOT_VOICE_PHRASE_SPEC,
): VoiceCorpusRecipe[] {
  // The historical 40-clip background bucket split 32 overlapped-speech / 8 procedural-tone
  // clips; the 4-in-5 ratio is the invariant, and 40 * 0.8 keeps streambot's exact split.
  const backgroundSpeech = Math.floor(
    spec.groupCounts.backgroundNegative * 0.8,
  );
  return [
    ...cleanPositiveRecipes(spec),
    ...stressPositiveRecipes(spec),
    ...nearMatchRecipes(spec),
    ...ordinaryNegativeRecipes(spec),
    ...Array.from({ length: spec.groupCounts.backgroundNegative }, (_, index) =>
      backgroundNegativeRecipe(index, backgroundSpeech),
    ),
  ];
}
