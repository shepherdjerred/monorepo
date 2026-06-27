/**
 * AI model configurations and capabilities for scout-for-lol.
 *
 * This is a thin adapter over the central catalog
 * (`@shepherdjerred/llm-models`). The catalog is the single source of truth for
 * pricing / capabilities / context windows; this module re-shapes the active
 * OpenAI text models and Gemini image models into scout's historical
 * `ModelInfo` / `GEMINI_PRICING` surface so existing consumers keep working.
 */
import {
  modelsByProvider,
  type ModelEntry,
  type TextPricing,
} from "@shepherdjerred/llm-models";

export type ModelCapabilities = {
  supportsTemperature: boolean;
  supportsTopP: boolean;
  maxTokens: number;
  costPer1MInputTokens: number;
  costPer1MOutputTokens: number;
};

export type ModelInfo = {
  id: string;
  name: string;
  description: string;
  capabilities: ModelCapabilities;
  category: "gpt-4" | "gpt-3.5" | "o-series" | "other";
  deprecated?: boolean;
};

function categorize(id: string): ModelInfo["category"] {
  if (id.startsWith("gpt-4")) {
    return "gpt-4";
  }
  if (id.startsWith("gpt-3.5")) {
    return "gpt-3.5";
  }
  if (/^o\d/.test(id)) {
    return "o-series";
  }
  return "other";
}

function toModelInfo(entry: ModelEntry, pricing: TextPricing): ModelInfo {
  const base: ModelInfo = {
    id: entry.id,
    name: entry.displayName,
    description: entry.description ?? "",
    capabilities: {
      supportsTemperature: entry.capabilities.supportsTemperature,
      supportsTopP: entry.capabilities.supportsTopP,
      maxTokens: entry.capabilities.maxTokens ?? 4096,
      costPer1MInputTokens: pricing.input,
      costPer1MOutputTokens: pricing.output,
    },
    category: categorize(entry.id),
  };
  return entry.status === "deprecated" ? { ...base, deprecated: true } : base;
}

function buildOpenAiModels(): Record<string, ModelInfo> {
  const models: Record<string, ModelInfo> = {};
  for (const entry of modelsByProvider("openai")) {
    // Skip embedding models — not selectable for text generation.
    if (entry.pricing.modality === "text" && entry.category !== "embedding") {
      models[entry.id] = toModelInfo(entry, entry.pricing);
    }
  }
  return models;
}

function buildGeminiPricing(): Record<string, number> {
  const pricing: Record<string, number> = {};
  for (const entry of modelsByProvider("google")) {
    if (entry.pricing.modality === "image") {
      pricing[entry.id] = entry.pricing.perImage;
    }
  }
  return pricing;
}

/**
 * Active OpenAI text models, keyed by id. Derived from the central catalog.
 */
export const OPENAI_MODELS: Record<string, ModelInfo> = buildOpenAiModels();

/**
 * Gemini image-generation pricing (USD per image), keyed by id. Derived from
 * the central catalog.
 */
export const GEMINI_PRICING: Record<string, number> = buildGeminiPricing();

/**
 * Get model configuration by ID
 */
export function getModelInfo(modelId: string): ModelInfo | undefined {
  // Direct lookup
  if (OPENAI_MODELS[modelId]) {
    return OPENAI_MODELS[modelId];
  }

  // Fuzzy match for versioned models (e.g., gpt-4-0613)
  for (const [key, model] of Object.entries(OPENAI_MODELS)) {
    if (modelId.startsWith(key) || key.startsWith(modelId)) {
      return model;
    }
  }

  return undefined;
}

/**
 * Get all models grouped by category
 */
export function getModelsByCategory(): Record<string, ModelInfo[]> {
  const grouped: Record<string, ModelInfo[]> = {
    "gpt-4": [],
    "gpt-3.5": [],
    "o-series": [],
    other: [],
  };

  for (const model of Object.values(OPENAI_MODELS)) {
    grouped[model.category]?.push(model);
  }

  return grouped;
}

/**
 * Get list of all model IDs
 */
export function getAllModelIds(): string[] {
  return Object.keys(OPENAI_MODELS);
}

/**
 * Check if a model supports a specific parameter
 */
export function modelSupportsParameter(
  modelId: string,
  parameter: "temperature" | "topP",
): boolean {
  const model = getModelInfo(modelId);
  if (!model) {
    // Default to false for unknown models to be safe
    return false;
  }

  switch (parameter) {
    case "temperature":
      return model.capabilities.supportsTemperature;
    case "topP":
      return model.capabilities.supportsTopP;
    default:
      return false;
  }
}

/**
 * Get recommended max tokens for a model
 */
export function getModelMaxTokens(modelId: string): number {
  const model = getModelInfo(modelId);
  return model?.capabilities.maxTokens ?? 4096;
}

/**
 * Get pricing for image generation
 * @throws Error if model pricing is not defined
 */
export function getImagePricing(model: string): number {
  // Check Gemini models
  for (const [modelName, pricing] of Object.entries(GEMINI_PRICING)) {
    if (model.includes(modelName) || modelName.includes(model)) {
      return pricing;
    }
  }

  // Error if model not found - all models must be explicitly defined
  throw new Error(
    `Image generation pricing not defined for model: ${model}. ` +
      `Please add it to the catalog (@shepherdjerred/llm-models).`,
  );
}

/**
 * Get pricing for a specific text generation model
 * @throws Error if model pricing is not defined
 */
export function getModelPricing(model: string): {
  input: number;
  output: number;
} {
  // Try to get pricing from centralized model info
  const modelInfo = getModelInfo(model);
  if (modelInfo) {
    return {
      input: modelInfo.capabilities.costPer1MInputTokens,
      output: modelInfo.capabilities.costPer1MOutputTokens,
    };
  }

  // Error if model not found - all models must be explicitly defined
  throw new Error(
    `Text generation pricing not defined for model: ${model}. ` +
      `Please add it to the catalog (@shepherdjerred/llm-models).`,
  );
}

/**
 * Cost breakdown for a generation request
 */
export type CostBreakdown = {
  textInputCost: number;
  textOutputCost: number;
  imageCost: number;
  totalCost: number;
};

/**
 * Generation metadata for cost calculation
 */
export type GenerationMetadata = {
  textTokensPrompt?: number | undefined;
  textTokensCompletion?: number | undefined;
  textDurationMs: number;
  imageDurationMs?: number | undefined;
  imageGenerated: boolean;
  selectedPersonality?: string | undefined;
  selectedArtStyle?: string | undefined;
};

/**
 * Calculate cost breakdown from generation metadata
 */
export function calculateCost(
  metadata: GenerationMetadata,
  textModel: string,
  imageModel: string,
): CostBreakdown {
  const modelPricing = getModelPricing(textModel);
  const imagePricing = getImagePricing(imageModel);

  // Calculate text generation costs
  const inputTokens = metadata.textTokensPrompt ?? 0;
  const outputTokens = metadata.textTokensCompletion ?? 0;

  const textInputCost = (inputTokens / 1_000_000) * modelPricing.input;
  const textOutputCost = (outputTokens / 1_000_000) * modelPricing.output;

  // Calculate image generation cost
  const imageCost = metadata.imageGenerated ? imagePricing : 0;

  const totalCost = textInputCost + textOutputCost + imageCost;

  return {
    textInputCost,
    textOutputCost,
    imageCost,
    totalCost,
  };
}

/**
 * Format cost as USD string
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}
