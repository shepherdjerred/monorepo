import { parseArgs } from "node:util";
import { z } from "zod";
import {
  AppleSyntheticTtsClient,
  generateVoiceCorpus,
  OpenAiSyntheticTtsClient,
} from "@shepherdjerred/streambot/voice/corpus-generator.ts";
import { resolveVoiceWakePhrase } from "@shepherdjerred/streambot/voice/corpus-phrases.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    refresh: { type: "boolean", default: false },
    phrase: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  process.stdout.write(`Generate a wake-phrase acceptance corpus.

Usage:
  bun run voice:corpus:generate [--phrase hey-streambot|hey-scout] [--refresh]

The default phrase is hey-streambot, writing streambot's canonical fixtures. Each phrase writes
into its own committed corpus directory. Requires OPENAI_API_KEY and, on macOS, the built-in
say voice plus ffmpeg.
`);
  process.exit(0);
}

const phrase = resolveVoiceWakePhrase(values.phrase);
const apiKey = z.string().min(1).parse(Bun.env["OPENAI_API_KEY"]);
const manifest = await generateVoiceCorpus({
  refresh: values.refresh,
  spec: phrase.spec,
  corpusDir: phrase.corpusDir,
  clients: {
    openai: new OpenAiSyntheticTtsClient(apiKey),
    apple: new AppleSyntheticTtsClient(Bun.env["FFMPEG_PATH"] ?? "ffmpeg"),
  },
});
process.stdout.write(
  `generated ${String(manifest.entries.length)} canonical ${phrase.slug} voice clips\n`,
);
