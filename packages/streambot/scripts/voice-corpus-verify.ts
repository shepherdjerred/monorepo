import { verifyVoiceCorpus } from "@shepherdjerred/streambot/voice/corpus-io.ts";

const result = await verifyVoiceCorpus();
process.stdout.write(
  `verified ${String(result.clipCount)} voice clips (${String(result.totalBytes)} bytes)\n`,
);
