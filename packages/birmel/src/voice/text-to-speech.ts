import OpenAI from "openai";
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

export async function generateSpeech(text: string): Promise<Buffer> {
  const config = getConfig();
  const openai = getOpenAIClient();
  const startTime = Date.now();

  logger.debug("Starting TTS generation", {
    textLength: text.length,
    model: config.openai.ttsModel,
    voice: config.openai.ttsVoice,
  });

  try {
    const response = await openai.audio.speech.create({
      model: config.openai.ttsModel,
      voice: config.openai.ttsVoice,
      input: text,
      speed: config.openai.ttsSpeed,
      response_format: "opus", // Best for Discord
    });

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const duration = Date.now() - startTime;
    logger.info("TTS generation complete", {
      textLength: text.length,
      audioSize: buffer.length,
      durationMs: duration,
    });

    return buffer;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("Failed to generate speech", {
      error,
      textLength: text.length,
      durationMs: duration,
    });
    throw error;
  }
}

export async function generateShortSpeech(text: string): Promise<Buffer> {
  // Truncate text to keep TTS responses concise for voice
  const maxLength = 500;
  const truncatedText =
    text.length > maxLength ? text.slice(0, maxLength) + "..." : text;

  return generateSpeech(truncatedText);
}
