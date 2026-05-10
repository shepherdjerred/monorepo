/**
 * Chat completion parameters - extracted to avoid dependency on concrete OpenAI types
 */
export type ChatCompletionCreateParams = {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  max_completion_tokens: number;
  temperature?: number;
  top_p?: number;
};

/**
 * Review text generation metadata
 */
export type ReviewTextMetadata = {
  textTokensPrompt?: number | undefined;
  textTokensCompletion?: number | undefined;
  textDurationMs: number;
  selectedPersonality?: string | undefined;
  reviewerName: string;
  playerName: string;
  systemPrompt: string;
  userPrompt: string;
  openaiRequestParams?: ChatCompletionCreateParams | undefined;
};

/**
 * Review image generation metadata
 */
export type ReviewImageMetadata = {
  imageDurationMs: number;
  geminiPrompt?: string | undefined;
  geminiModel?: string | undefined;
};
