/**
 * AI model configurations and capabilities
 *
 * PRICING UPDATE NOTES:
 * - OpenAI and Gemini do NOT provide pricing APIs
 * - Pricing must be updated manually by checking official sources:
 *   - OpenAI: https://platform.openai.com/pricing
 *   - Gemini: https://ai.google.dev/pricing
 * - Last updated: December 2025
 * - Recommended: Check for updates quarterly
 */

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

/**
 * Comprehensive list of OpenAI models with their capabilities
 * Pricing verified from https://platform.openai.com/pricing
 * Last updated: December 2025
 */
export const OPENAI_MODELS: Record<string, ModelInfo> = {
  // GPT-4o Series (Most capable, multimodal)
  "gpt-4o": {
    id: "gpt-4o",
    name: "GPT-4o",
    description:
      "⚡ Fast & capable multimodal model • $2.50 input / $10 output per 1M tokens",
    capabilities: {
      supportsTemperature: true,
      supportsTopP: true,
      maxTokens: 16_384,
      costPer1MInputTokens: 2.5,
      costPer1MOutputTokens: 10,
    },
    category: "gpt-4",
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    description:
      "💰 Most affordable GPT-4 level model • $0.15 input / $0.60 output per 1M tokens",
    capabilities: {
      supportsTemperature: true,
      supportsTopP: true,
      maxTokens: 16_384,
      costPer1MInputTokens: 0.15,
      costPer1MOutputTokens: 0.6,
    },
    category: "gpt-4",
  },
  "gpt-4o-2024-11-20": {
    id: "gpt-4o-2024-11-20",
    name: "GPT-4o (2024-11-20)",
    description: "📅 Latest snapshot • Same as gpt-4o",
    capabilities: {
      supportsTemperature: true,
      supportsTopP: true,
      maxTokens: 16_384,
      costPer1MInputTokens: 2.5,
      costPer1MOutputTokens: 10,
    },
    category: "gpt-4",
  },
  "chatgpt-4o-latest": {
    id: "chatgpt-4o-latest",
    name: "ChatGPT-4o (Latest)",
    description:
      "🔄 Auto-updated to match ChatGPT • $5 input / $15 output per 1M tokens",
    capabilities: {
      supportsTemperature: true,
      supportsTopP: true,
      maxTokens: 16_384,
      costPer1MInputTokens: 5,
      costPer1MOutputTokens: 15,
    },
    category: "gpt-4",
  },

  // O-Series (Reasoning models)
  o1: {
    id: "o1",
    name: "O1",
    description:
      "🧠 Advanced reasoning for complex problems • $15 input / $60 output per 1M tokens • No temp control",
    capabilities: {
      supportsTemperature: false, // O-series models don't support temperature
      supportsTopP: false,
      maxTokens: 100_000,
      costPer1MInputTokens: 15,
      costPer1MOutputTokens: 60,
    },
    category: "o-series",
  },
  "o1-mini": {
    id: "o1-mini",
    name: "O1 Mini",
    description:
      "🚀 Fast reasoning for code/math • $3 input / $12 output per 1M tokens • No temp control",
    capabilities: {
      supportsTemperature: false,
      supportsTopP: false,
      maxTokens: 65_536,
      costPer1MInputTokens: 3,
      costPer1MOutputTokens: 12,
    },
    category: "o-series",
  },
  "o1-preview": {
    id: "o1-preview",
    name: "O1 Preview",
    description:
      "🔬 Early O1 preview • $15 input / $60 output per 1M tokens • No temp control",
    capabilities: {
      supportsTemperature: false,
      supportsTopP: false,
      maxTokens: 32_768,
      costPer1MInputTokens: 15,
      costPer1MOutputTokens: 60,
    },
    category: "o-series",
  },
  "o3-mini": {
    id: "o3-mini",
    name: "O3 Mini",
    description:
      "🎯 Budget reasoning model • $1.10 input / $4.40 output per 1M tokens • No temp control",
    capabilities: {
      supportsTemperature: false,
      supportsTopP: false,
      maxTokens: 100_000,
      costPer1MInputTokens: 1.1,
      costPer1MOutputTokens: 4.4,
    },
    category: "o-series",
  },

  // GPT-4 Turbo Series
  "gpt-4-turbo": {
    id: "gpt-4-turbo",
    name: "GPT-4 Turbo",
    description:
      "📸 Vision + large context • $10 input / $30 output per 1M tokens",
    capabilities: {
      supportsTemperature: true,
      supportsTopP: true,
      maxTokens: 4096,
      costPer1MInputTokens: 10,
      costPer1MOutputTokens: 30,
    },
    category: "gpt-4",
  },
  "gpt-4-turbo-preview": {
    id: "gpt-4-turbo-preview",
    name: "GPT-4 Turbo Preview",
    description: "🔍 Preview version • Same pricing as gpt-4-turbo",
    capabilities: {
      supportsTemperature: true,
      supportsTopP: true,
      maxTokens: 4096,
      costPer1MInputTokens: 10,
      costPer1MOutputTokens: 30,
    },
    category: "gpt-4",
  },

  // Standard GPT-4
  "gpt-4": {
    id: "gpt-4",
    name: "GPT-4",
    description:
      "⚠️ Original GPT-4 (deprecated) • $30 input / $60 output per 1M tokens • Use gpt-4o instead",
    capabilities: {
      supportsTemperature: true,
      supportsTopP: true,
      maxTokens: 8192,
      costPer1MInputTokens: 30,
      costPer1MOutputTokens: 60,
    },
    category: "gpt-4",
    deprecated: true,
  },

  // GPT-3.5 Series
  "gpt-3.5-turbo": {
    id: "gpt-3.5-turbo",
    name: "GPT-3.5 Turbo",
    description:
      "⚡ Fast & cheap for simple tasks • $0.50 input / $1.50 output per 1M tokens",
    capabilities: {
      supportsTemperature: true,
      supportsTopP: true,
      maxTokens: 4096,
      costPer1MInputTokens: 0.5,
      costPer1MOutputTokens: 1.5,
    },
    category: "gpt-3.5",
  },
  "gpt-3.5-turbo-16k": {
    id: "gpt-3.5-turbo-16k",
    name: "GPT-3.5 Turbo (16k)",
    description: "📚 Large context window • Same pricing as gpt-3.5-turbo",
    capabilities: {
      supportsTemperature: true,
      supportsTopP: true,
      maxTokens: 16_384,
      costPer1MInputTokens: 0.5,
      costPer1MOutputTokens: 1.5,
    },
    category: "gpt-3.5",
  },

  // GPT-5 Series (Reasoning models - no temperature/topP support)
  "gpt-5": {
    id: "gpt-5",
    name: "GPT-5",
    description:
      "🧠 GPT-5 base model • $1.25 input / $10 output per 1M tokens • No temp control",
    capabilities: {
      supportsTemperature: false,
      supportsTopP: false,
      maxTokens: 400_000,
      costPer1MInputTokens: 1.25,
      costPer1MOutputTokens: 10,
    },
    category: "other",
  },
  "gpt-5-mini": {
    id: "gpt-5-mini",
    name: "GPT-5 Mini",
    description:
      "💰 Balanced GPT-5 variant • $0.25 input / $2 output per 1M tokens • No temp control",
    capabilities: {
      supportsTemperature: false,
      supportsTopP: false,
      maxTokens: 200_000,
      costPer1MInputTokens: 0.25,
      costPer1MOutputTokens: 2,
    },
    category: "other",
  },
  "gpt-5-nano": {
    id: "gpt-5-nano",
    name: "GPT-5 Nano",
    description:
      "⚡ Fastest, most cost-effective • $0.05 input / $0.40 output per 1M tokens • No temp control",
    capabilities: {
      supportsTemperature: false,
      supportsTopP: false,
      maxTokens: 100_000,
      costPer1MInputTokens: 0.05,
      costPer1MOutputTokens: 0.4,
    },
    category: "other",
  },

  // GPT-5.1 (Latest flagship model - no temperature/topP support)
  "gpt-5.1": {
    id: "gpt-5.1",
    name: "GPT-5.1",
    description:
      "🚀 Latest GPT-5.1 • 400k context • $1.25 input / $10 output per 1M tokens • No temp control",
    capabilities: {
      supportsTemperature: false,
      supportsTopP: false,
      maxTokens: 400_000,
      costPer1MInputTokens: 1.25,
      costPer1MOutputTokens: 10,
    },
    category: "other",
  },
};

/**
 * Gemini/Imagen pricing (per image)
 * Verified from https://ai.google.dev/pricing
 * Last updated: November 2025
 */
export const GEMINI_PRICING = {
  // Imagen 3 pricing (used by Gemini 2.0 Flash for image generation)
  "gemini-2.0-flash-exp": 0.03, // $0.03 per image
  "gemini-2.0-flash": 0.03, // $0.03 per image
  "imagen-3.0-generate": 0.03, // $0.03 per image
  // Preview/experimental models (pricing not officially documented)
  "gemini-3-pro-image-preview": 0.15, // $0.15 per image (estimated - preview model, no official pricing yet)
  // Legacy pricing for older models (if used)
  "gemini-1.5-pro": 0.1, // $0.10 per image (estimated, not officially documented)
  "gemini-1.5-flash": 0.05, // $0.05 per image (estimated, not officially documented)
} as const;

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
      `Please add it to GEMINI_PRICING in packages/data/src/review/models.ts`,
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
      `Please add it to OPENAI_MODELS in packages/data/src/review/models.ts`,
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
