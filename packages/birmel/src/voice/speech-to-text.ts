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
  const startTime = Date.now();

  logger.debug("Starting audio transcription", {
    bufferSize: audioBuffer.length,
    model: config.openai.whisperModel,
  });

  try {
    const file = await toFile(audioBuffer, "audio.wav", { type: "audio/wav" });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: config.openai.whisperModel,
      language: "en",
    });

    const duration = Date.now() - startTime;
    logger.info("Audio transcription complete", {
      bufferSize: audioBuffer.length,
      durationMs: duration,
      textLength: transcription.text.length,
      textPreview: transcription.text.slice(0, 100),
    });

    return transcription.text;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("Failed to transcribe audio", {
      error,
      bufferSize: audioBuffer.length,
      durationMs: duration,
    });
    throw error;
  }
}
