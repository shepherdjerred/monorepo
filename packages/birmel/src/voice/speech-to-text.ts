import OpenAI, { toFile } from "openai";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/index.js";

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const config = getConfig();
    openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return openaiClient;
}

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const config = getConfig();
  const openai = getOpenAIClient();

  try {
    const file = await toFile(audioBuffer, "audio.wav", { type: "audio/wav" });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: config.openai.whisperModel,
      language: "en",
    });

    logger.debug("Transcribed audio", {
      length: audioBuffer.length,
      text: transcription.text.slice(0, 100),
    });

    return transcription.text;
  } catch (error) {
    logger.error("Failed to transcribe audio", error);
    throw error;
  }
}
