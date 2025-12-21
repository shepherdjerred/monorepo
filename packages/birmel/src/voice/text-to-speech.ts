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

    logger.debug("Generated speech", {
      textLength: text.length,
      audioSize: buffer.length,
    });

    return buffer;
  } catch (error) {
    logger.error("Failed to generate speech", error);
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
