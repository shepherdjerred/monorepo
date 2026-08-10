import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { initializeLocalVoiceModelsForRuntime } from "@shepherdjerred/streambot/voice/local-models.ts";

const config = loadConfig({
  BOT_TOKEN: "image-smoke",
  USER_TOKENS: "image-smoke",
  VIDEOS_DIR: "/tmp",
  VOICE_ASSISTANT_ENABLED: Bun.env["VOICE_ASSISTANT_ENABLED"],
  OPENAI_API_KEY: Bun.env["OPENAI_API_KEY"],
  VOICE_ASSETS_DIR: Bun.env["VOICE_ASSETS_DIR"],
});
for (const runtime of ["native", "wasm"] as const) {
  const models = await initializeLocalVoiceModelsForRuntime(
    config.voice.assetsDir,
    runtime,
  );
  process.stdout.write(`voice model smoke passed (${models.runtime})\n`);
  await models.close();
}
