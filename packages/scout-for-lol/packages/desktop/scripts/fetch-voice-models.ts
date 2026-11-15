// Assembles the scout-voice model directory, checking every SHA-256. The
// keyword spotter archive and Silero VAD are downloaded from the pinned URLs
// in data/src/scout-client/voice-cascade.contract.json; the trained "hey
// scout" verifier and keywords file are copied from backend/assets/voice,
// where they are already committed. Nothing here is committed under desktop/.
//   bun scripts/fetch-voice-models.ts [destination]   (default target/voice-models)
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { download, sha256 } from "./verified-download.ts";
import { SCOUT_VOICE_CASCADE } from "../../data/src/scout-client/voice-cascade.schema.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const backendAssets = join(root, "../backend/assets/voice");
const destination = process.argv[2] ?? join(root, "target/voice-models");
const { models } = SCOUT_VOICE_CASCADE;
const kws = models.keywordSpotter;

async function check(name: string, expected: string): Promise<void> {
  const actual = sha256(await readFile(join(destination, name)));
  if (actual !== expected) {
    throw new Error(`${name} has SHA-256 ${actual}, expected ${expected}`);
  }
}

await mkdir(destination, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), "scout-voice-models-"));
try {
  const archive = join(scratch, "kws.tar.bz2");
  await writeFile(archive, await download(kws.archiveUrl, kws.archiveSha256));
  const wanted = [kws.encoder, kws.decoder, kws.joiner, kws.tokens, kws.bpe];
  const extract = Bun.spawn(
    ["tar", "-xjf", archive, "-C", scratch, "--strip-components=1"],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await extract.exited) !== 0) {
    throw new Error("extracting the keyword spotter archive failed");
  }
  for (const file of wanted) {
    await copyFile(join(scratch, file.name), join(destination, file.name));
  }
  await writeFile(
    join(destination, models.vad.name),
    await download(models.vad.url, models.vad.sha256),
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}

const { verifier } = models;
for (const name of [
  models.keywordSpotter.keywords.name,
  verifier.manifest,
  verifier.melspectrogram,
  verifier.embedding,
  verifier.classifier,
  verifier.smokePositive,
]) {
  await copyFile(join(backendAssets, name), join(destination, name));
}

for (const file of [
  kws.encoder,
  kws.decoder,
  kws.joiner,
  kws.tokens,
  kws.bpe,
  kws.keywords,
]) {
  await check(file.name, file.sha256);
}
await check(models.vad.name, models.vad.sha256);
// The verifier's checksums live in its own manifest; scout-voice checks
// them again when it locates the directory.
console.log(`voice models ready in ${destination}`);
