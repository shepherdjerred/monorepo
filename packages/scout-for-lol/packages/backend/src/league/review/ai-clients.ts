import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import config from "@scout-for-lol/backend/configuration.ts";

/**
 * Initialize OpenAI client if API key is configured
 */
export function getOpenAIClient(): OpenAI | undefined {
  if (config.openaiApiKey === undefined) {
    return undefined;
  }
  return new OpenAI({ apiKey: config.openaiApiKey });
}

/**
 * Initialize Gemini client if API key is configured
 */
export function getGeminiClient(): GoogleGenerativeAI | undefined {
  if (config.geminiApiKey === undefined) {
    return undefined;
  }
  return new GoogleGenerativeAI(config.geminiApiKey);
}
