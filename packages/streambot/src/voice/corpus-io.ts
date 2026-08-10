import path from "node:path";
import { mkdir, rename } from "node:fs/promises";
import {
  VOICE_CORPUS_CLIP_COUNT,
  VOICE_CORPUS_MAX_BYTES,
  VoiceCorpusManifestSchema,
  type VoiceCorpusManifest,
} from "@shepherdjerred/streambot/voice/corpus-schema.ts";
import { decodeDiscordOpusContainer } from "@shepherdjerred/streambot/voice/discord-opus-container.ts";

export const DEFAULT_VOICE_CORPUS_DIR = path.resolve(
  import.meta.dir,
  "../../test/fixtures/voice-corpus",
);

export function sha256(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

export async function atomicWrite(
  destination: string,
  bytes: Uint8Array | string,
): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const staging = `${destination}.tmp-${crypto.randomUUID()}`;
  await Bun.write(staging, bytes);
  await rename(staging, destination);
}

export async function loadVoiceCorpusManifest(
  corpusDir = DEFAULT_VOICE_CORPUS_DIR,
): Promise<VoiceCorpusManifest> {
  const file = Bun.file(path.join(corpusDir, "manifest.json"));
  if (!(await file.exists())) {
    throw new Error(
      `Voice corpus manifest is missing: ${file.name ?? "manifest.json"}`,
    );
  }
  return VoiceCorpusManifestSchema.parse(await file.json());
}

export type VoiceCorpusVerification = {
  readonly clipCount: number;
  readonly totalBytes: number;
};

export async function verifyVoiceCorpus(
  corpusDir = DEFAULT_VOICE_CORPUS_DIR,
  requireComplete = true,
): Promise<VoiceCorpusVerification> {
  const manifest = await loadVoiceCorpusManifest(corpusDir);
  if (requireComplete && manifest.entries.length !== VOICE_CORPUS_CLIP_COUNT) {
    throw new Error(
      `Voice corpus must contain ${String(VOICE_CORPUS_CLIP_COUNT)} entries, found ${String(manifest.entries.length)}`,
    );
  }
  const ids = new Set<string>();
  const files = new Set<string>();
  let totalBytes = 0;
  for (const entry of manifest.entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate corpus id: ${entry.id}`);
    if (files.has(entry.file))
      throw new Error(`Duplicate corpus file: ${entry.file}`);
    ids.add(entry.id);
    files.add(entry.file);
    const bytes = new Uint8Array(
      await Bun.file(path.join(corpusDir, entry.file)).arrayBuffer(),
    );
    totalBytes += bytes.byteLength;
    if (sha256(bytes) !== entry.sha256) {
      throw new Error(`Voice corpus checksum mismatch: ${entry.file}`);
    }
    const container = decodeDiscordOpusContainer(bytes);
    if (container.packets.length !== entry.packetCount) {
      throw new Error(`Voice corpus packet count mismatch: ${entry.file}`);
    }
    if (container.durationMs !== entry.durationMs) {
      throw new Error(`Voice corpus duration mismatch: ${entry.file}`);
    }
  }
  if (totalBytes > VOICE_CORPUS_MAX_BYTES) {
    throw new Error(
      `Voice corpus is ${String(totalBytes)} bytes; maximum is ${String(VOICE_CORPUS_MAX_BYTES)}`,
    );
  }
  return { clipCount: manifest.entries.length, totalBytes };
}
