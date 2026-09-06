import { verifyVoiceCorpus } from "@shepherdjerred/streambot/voice/corpus-io.ts";
import {
  parsePhraseCliArgs,
  resolveVoiceWakePhrase,
} from "@shepherdjerred/streambot/voice/corpus-phrases.ts";

const values =
  parsePhraseCliArgs(`Verify a committed wake-phrase corpus against its manifest.

Usage:
  bun run voice:corpus:verify [--phrase hey-streambot|hey-scout]
`);

const phrase = resolveVoiceWakePhrase(values.phrase);
const result = await verifyVoiceCorpus(phrase.corpusDir, true, phrase.spec);
process.stdout.write(
  `verified ${String(result.clipCount)} ${phrase.slug} voice clips (${String(result.totalBytes)} bytes)\n`,
);
