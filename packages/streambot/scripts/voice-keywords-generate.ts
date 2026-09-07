/**
 * Generate a sherpa KWS keywords file for a wake phrase from the pinned base model's own
 * tokenizer. Every BPE piece comes from encoding the fragment text with the model's `bpe.model`
 * (the same tokenization sherpa's text2token performs) and is then checked against `tokens.txt`,
 * so a guessed or drifted piece can never be written.
 *
 *   bun run scripts/voice-keywords-generate.ts [--phrase-slug hey-scout] \
 *     [--model-dir <dir with tokens.txt + bpe.model>] [--dest <file>] [--check]
 *
 * Requires `uv` (runs sentencepiece via `uv run --with sentencepiece`). The default model dir is
 * the harness export (`bun run voice:harness:prepare`). --check regenerates and compares against
 * the destination instead of writing, proving a committed keywords file matches the pinned model.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  resolveVoiceWakePhrase,
  verifierPackagingPlan,
  wakeVerifierFileNames,
} from "@shepherdjerred/streambot/voice/corpus-phrases.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "phrase-slug": { type: "string", default: "hey-streambot" },
    "model-dir": { type: "string" },
    dest: { type: "string" },
    check: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  process.stdout
    .write(`Generate a wake-phrase sherpa keywords file from the pinned tokenizer.

Usage:
  bun run scripts/voice-keywords-generate.ts [--phrase-slug hey-streambot|hey-scout]
    [--model-dir <dir>] [--dest <file>] [--check]
`);
  process.exit(0);
}

const slug = z.string().min(1).parse(values["phrase-slug"]);
const phrase = resolveVoiceWakePhrase(slug);
const modelDir = path.resolve(
  values["model-dir"] ??
    path.resolve(import.meta.dir, "../../../.context/streambot-voice-models"),
);
const destination = path.resolve(
  values.dest ??
    path.join(
      verifierPackagingPlan(slug).destination,
      wakeVerifierFileNames(slug).keywords,
    ),
);

const bpeModel = path.join(modelDir, "bpe.model");
const tokensFile = path.join(modelDir, "tokens.txt");
for (const required of [bpeModel, tokensFile]) {
  if (!(await Bun.file(required).exists())) {
    throw new Error(
      `Pinned tokenizer asset is missing: ${required} (run \`bun run voice:harness:prepare\` or pass --model-dir)`,
    );
  }
}
if (Bun.which("uv") === null) {
  throw new Error("uv is required to run sentencepiece for BPE encoding");
}

const encodeProgram = `import json, sys
import sentencepiece as spm
sp = spm.SentencePieceProcessor()
sp.load(sys.argv[1])
print(json.dumps([sp.encode(text, out_type=str) for text in json.loads(sys.argv[2])]))
`;
const texts = phrase.keywordFragments.map((fragment) => fragment.text);
const child = Bun.spawn(
  [
    "uv",
    "run",
    "--with",
    "sentencepiece",
    "python3",
    "-",
    bpeModel,
    JSON.stringify(texts),
  ],
  { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
);
await child.stdin.write(encodeProgram);
await child.stdin.end();
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
if (exitCode !== 0) {
  throw new Error(`sentencepiece encoding failed: ${stderr.trim()}`);
}
const encoded = z
  .array(z.array(z.string().min(1)))
  .length(phrase.keywordFragments.length)
  .parse(JSON.parse(stdout));

const tokensText = await Bun.file(tokensFile).text();
const knownTokens = new Set(
  tokensText
    .split("\n")
    .map((line) => line.split(" ")[0])
    .filter((token) => token !== undefined && token.length > 0),
);
const missing = encoded.flat().filter((piece) => !knownTokens.has(piece));
if (missing.length > 0) {
  throw new Error(
    `BPE pieces are absent from ${tokensFile}: ${[...new Set(missing)].join(", ")}`,
  );
}

const lines = phrase.keywordFragments.map((fragment, index) => {
  const pieces = encoded[index];
  if (pieces === undefined || pieces.length === 0) {
    throw new Error(`Fragment "${fragment.label}" encoded to no BPE pieces`);
  }
  return `${pieces.join(" ")} :${fragment.boost.toFixed(1)} #${fragment.threshold.toFixed(2)} @${fragment.label}`;
});
const content = `${lines.join("\n")}\n`;

if (values.check) {
  const existing = await Bun.file(destination).text();
  if (existing !== content) {
    throw new Error(
      `Committed keywords file ${destination} does not match the pinned tokenizer output`,
    );
  }
  process.stdout.write(
    `verified ${destination} against the pinned tokenizer (${String(lines.length)} fragments)\n`,
  );
} else {
  await Bun.write(destination, content);
  process.stdout.write(
    `wrote ${destination} (${String(lines.length)} fragments)\n`,
  );
}
