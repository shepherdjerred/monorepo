import { z } from "zod";
import {
  AppleSyntheticTtsClient,
  generateVoiceCorpus,
  OpenAiSyntheticTtsClient,
} from "@shepherdjerred/streambot/voice/corpus-generator.ts";

const ArgsSchema = z.strictObject({ refresh: z.boolean() });
const args = ArgsSchema.parse({
  refresh: Bun.argv.slice(2).includes("--refresh"),
});
const apiKey = z.string().min(1).parse(Bun.env["OPENAI_API_KEY"]);
const manifest = await generateVoiceCorpus({
  refresh: args.refresh,
  clients: {
    openai: new OpenAiSyntheticTtsClient(apiKey),
    apple: new AppleSyntheticTtsClient(Bun.env["FFMPEG_PATH"] ?? "ffmpeg"),
  },
});
process.stdout.write(
  `generated ${String(manifest.entries.length)} canonical voice clips\n`,
);
