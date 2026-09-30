/**
 * Regenerate the committed spoken-feedback clips for a wake phrase. macOS-only (uses the built-in
 * `say` voice, keyless) plus ffmpeg for the 24 kHz mono PCM16 conversion the assistant sink
 * expects. Run only when the wording changes; the WAVs are committed assets, not build outputs.
 *
 *   bun run scripts/voice-feedback-generate.ts [--phrase hey-streambot|hey-scout]
 *
 * The hey-scout clips have not been generated yet; per the training plan, prefer OpenAI TTS
 * output over `say` for Scout's shipped WAVs when that step lands.
 */
import path from "node:path";
import {
  parsePhraseCliArgs,
  resolveVoiceWakePhrase,
} from "@shepherdjerred/streambot/voice/corpus-phrases.ts";

type FeedbackLine = { readonly file: string; readonly text: string };

const FEEDBACK_LINES: Record<
  "hey-streambot" | "hey-scout",
  readonly FeedbackLine[]
> = {
  "hey-streambot": [
    {
      file: "feedback-retry.wav",
      text: "Sorry, I didn't catch that. Say Hey Streambot and try again.",
    },
    { file: "feedback-prompt.wav", text: "What would you like me to play?" },
  ],
  "hey-scout": [
    {
      file: "feedback-retry.wav",
      text: "Sorry, I didn't catch that. Say Hey Scout and try again.",
    },
    { file: "feedback-prompt.wav", text: "What would you like to know?" },
  ],
};

const DESTINATIONS: Record<"hey-streambot" | "hey-scout", string> = {
  "hey-streambot": path.join(import.meta.dir, "..", "assets", "voice"),
  "hey-scout": path.join(
    import.meta.dir,
    "../../scout-for-lol/packages/backend/assets/voice",
  ),
};

const values = parsePhraseCliArgs(
  `Regenerate committed spoken-feedback clips for a wake phrase.

Usage:
  bun run scripts/voice-feedback-generate.ts [--phrase hey-streambot|hey-scout]
`,
);

const phrase = resolveVoiceWakePhrase(values.phrase);
const lines = FEEDBACK_LINES[phrase.slug];
const assetsDir = DESTINATIONS[phrase.slug];

async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) {
    throw new Error(`Command failed: ${command.join(" ")}`);
  }
}

for (const line of lines) {
  const aiff = path.join("/tmp", `${line.file}.aiff`);
  await run(["say", "-v", "Samantha", "-o", aiff, line.text]);
  await run([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-i",
    aiff,
    "-ar",
    "24000",
    "-ac",
    "1",
    "-sample_fmt",
    "s16",
    path.join(assetsDir, line.file),
  ]);
  console.log(`wrote ${path.join(assetsDir, line.file)}`);
}
