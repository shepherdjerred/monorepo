import { parseArgs } from "node:util";
import { verifyVoiceCorpus } from "@shepherdjerred/streambot/voice/corpus-io.ts";
import { resolveVoiceWakePhrase } from "@shepherdjerred/streambot/voice/corpus-phrases.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    phrase: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  process.stdout
    .write(`Verify a committed wake-phrase corpus against its manifest.

Usage:
  bun run voice:corpus:verify [--phrase hey-streambot|hey-scout]
`);
  process.exit(0);
}

const phrase = resolveVoiceWakePhrase(values.phrase);
const result = await verifyVoiceCorpus(phrase.corpusDir, true, phrase.spec);
process.stdout.write(
  `verified ${String(result.clipCount)} ${phrase.slug} voice clips (${String(result.totalBytes)} bytes)\n`,
);
