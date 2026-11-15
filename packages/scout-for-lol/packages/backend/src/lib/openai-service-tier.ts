/**
 * OpenAI Ultrafast exists only for GPT-6 Astra and GPT-6.1 Sol. Every other
 * catalog model rejects `service_tier: "ultrafast"`.
 *
 * https://developers.openai.com/api/docs/guides/ultrafast-mode
 */
const ULTRAFAST_MODELS = new Set(["gpt-6-astra", "gpt-6.1-sol"]);

export function supportsOpenAiUltrafast(model: string): boolean {
  return ULTRAFAST_MODELS.has(model);
}
