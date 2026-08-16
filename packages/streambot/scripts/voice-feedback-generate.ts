/**
 * Regenerate the committed spoken-feedback clips in assets/voice/. macOS-only (uses the built-in
 * `say` voice, keyless) plus ffmpeg for the 24 kHz mono PCM16 conversion the assistant sink
 * expects. Run only when the wording changes; the WAVs are committed assets, not build outputs.
 *
 *   bun run scripts/voice-feedback-generate.ts
 */
import path from "node:path";

const LINES: readonly { file: string; text: string }[] = [
  {
    file: "feedback-retry.wav",
    text: "Sorry, I didn't catch that. Say Hey Streambot and try again.",
  },
  { file: "feedback-prompt.wav", text: "What would you like me to play?" },
];

const assetsDir = path.join(import.meta.dir, "..", "assets", "voice");

async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) {
    throw new Error(`Command failed: ${command.join(" ")}`);
  }
}

for (const line of LINES) {
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
  console.log(`wrote assets/voice/${line.file}`);
}
