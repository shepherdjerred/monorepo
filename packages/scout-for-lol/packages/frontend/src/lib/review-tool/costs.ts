/**
 * Cost calculation for AI API usage
 */
import type {
  GenerationMetadata,
  CostBreakdown,
  PipelineTraces,
  StageTrace,
  ImageGenerationTrace,
} from "./config/schema.ts";
import { CostBreakdownSchema } from "./config/schema.ts";
import {
  calculateCost as calculateCostShared,
  formatCost as formatCostShared,
  getModelPricing,
  getImagePricing,
} from "@scout-for-lol/data";
import { STORES, getItem, setItem } from "./storage.ts";

/**
 * Calculate cost breakdown from generation metadata
 */
export function calculateCost(
  metadata: GenerationMetadata,
  textModel: string,
  imageModel: string,
): CostBreakdown {
  return calculateCostShared(metadata, textModel, imageModel);
}

/**
 * Format cost as USD string
 */
export function formatCost(cost: number): string {
  return formatCostShared(cost);
}

/**
 * Cost breakdown for a single pipeline stage
 */
export type StageCost = {
  inputCost: number;
  outputCost: number;
  totalCost: number;
};

/**
 * Per-stage cost breakdown for the entire pipeline
 */
export type PipelineCostBreakdown = {
  timelineSummary?: StageCost;
  matchSummary?: StageCost;
  reviewText?: StageCost;
  imageDescription?: StageCost;
  imageGeneration?: { cost: number };
  total: CostBreakdown;
};

/**
 * Calculate cost for a single text generation stage
 */
function calculateStageCost(trace: StageTrace): StageCost {
  const modelPricing = getModelPricing(trace.model.model);
  const inputTokens = trace.tokensPrompt ?? 0;
  const outputTokens = trace.tokensCompletion ?? 0;

  const inputCost = (inputTokens / 1_000_000) * modelPricing.input;
  const outputCost = (outputTokens / 1_000_000) * modelPricing.output;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

/**
 * Calculate cost for image generation stage
 */
function calculateImageCost(trace: ImageGenerationTrace): number {
  if (!trace.response.imageGenerated) {
    return 0;
  }
  return getImagePricing(trace.model);
}

/**
 * Calculate per-stage cost breakdown from pipeline traces
 */
export function calculatePipelineCosts(
  traces: PipelineTraces,
  _imageModel: string,
): PipelineCostBreakdown {
  const result: PipelineCostBreakdown = {
    total: {
      textInputCost: 0,
      textOutputCost: 0,
      imageCost: 0,
      totalCost: 0,
    },
  };

  // Calculate per-stage costs
  if (traces.timelineSummary) {
    result.timelineSummary = calculateStageCost(traces.timelineSummary);
    result.total.textInputCost += result.timelineSummary.inputCost;
    result.total.textOutputCost += result.timelineSummary.outputCost;
  }

  if (traces.matchSummary) {
    result.matchSummary = calculateStageCost(traces.matchSummary);
    result.total.textInputCost += result.matchSummary.inputCost;
    result.total.textOutputCost += result.matchSummary.outputCost;
  }

  result.reviewText = calculateStageCost(traces.reviewText);
  result.total.textInputCost += result.reviewText.inputCost;
  result.total.textOutputCost += result.reviewText.outputCost;

  if (traces.imageDescription) {
    result.imageDescription = calculateStageCost(traces.imageDescription);
    result.total.textInputCost += result.imageDescription.inputCost;
    result.total.textOutputCost += result.imageDescription.outputCost;
  }

  if (traces.imageGeneration) {
    const imageCost = calculateImageCost(traces.imageGeneration);
    result.imageGeneration = { cost: imageCost };
    result.total.imageCost = imageCost;
  }

  result.total.totalCost =
    result.total.textInputCost +
    result.total.textOutputCost +
    result.total.imageCost;

  return result;
}

/**
 * Session cost tracker with IndexedDB persistence
 */
export class CostTracker {
  private costs: CostBreakdown[] = [];
  private readonly initPromise: Promise<void>;
  private readonly subscribers = new Set<() => void>();
  private cachedTotal: CostBreakdown = {
    textInputCost: 0,
    textOutputCost: 0,
    imageCost: 0,
    totalCost: 0,
  };
  private cachedSnapshot: { total: CostBreakdown; count: number } = {
    total: this.cachedTotal,
    count: 0,
  };

  constructor() {
    // Load costs from IndexedDB on initialization
    this.initPromise = this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    try {
      const stored = await getItem(STORES.COSTS, "costs");
      if (stored !== undefined && stored !== null) {
        const ArraySchema = CostBreakdownSchema.array();
        const result = ArraySchema.safeParse(stored);
        if (result.success) {
          this.costs = result.data;
          this.updateCachedTotal();
          this.notifySubscribers();
        }
      }
    } catch (error) {
      // Silently fail if storage fails
      console.error("Failed to load costs from storage:", error);
    }
  }

  private async saveToStorage(): Promise<void> {
    try {
      await setItem(STORES.COSTS, "costs", this.costs);
    } catch (error) {
      // Silently fail if storage fails
      console.error("Failed to save costs to storage:", error);
    }
  }

  private updateCachedTotal(): void {
    this.cachedTotal = this.costs.reduce(
      (acc, cost) => ({
        textInputCost: acc.textInputCost + cost.textInputCost,
        textOutputCost: acc.textOutputCost + cost.textOutputCost,
        imageCost: acc.imageCost + cost.imageCost,
        totalCost: acc.totalCost + cost.totalCost,
      }),
      {
        textInputCost: 0,
        textOutputCost: 0,
        imageCost: 0,
        totalCost: 0,
      },
    );
    // Update cached snapshot with new stable reference
    this.cachedSnapshot = {
      total: this.cachedTotal,
      count: this.costs.length,
    };
  }

  private notifySubscribers(): void {
    this.subscribers.forEach((callback) => {
      callback();
    });
  }

  /** Subscribe to cost updates - returns unsubscribe function */
  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /** Get current snapshot synchronously (safe to call from useSyncExternalStore) */
  getSnapshot(): { total: CostBreakdown; count: number } {
    // Return cached snapshot to avoid creating new object reference on every call
    return this.cachedSnapshot;
  }

  async add(cost: CostBreakdown): Promise<void> {
    await this.initPromise;
    this.costs.push(cost);
    this.updateCachedTotal();
    this.notifySubscribers();
    await this.saveToStorage();
  }

  async getTotal(): Promise<CostBreakdown> {
    await this.initPromise;
    return this.cachedTotal;
  }

  getCount(): number {
    return this.costs.length;
  }

  async getCosts(): Promise<CostBreakdown[]> {
    await this.initPromise;
    return [...this.costs];
  }

  async clear(): Promise<void> {
    await this.initPromise;
    this.costs = [];
    this.updateCachedTotal();
    this.notifySubscribers();
    await this.saveToStorage();
  }

  async export(): Promise<string> {
    await this.initPromise;
    const lines = [
      "Cost Report",
      "===========",
      `Total Requests: ${this.costs.length.toString()}`,
      "",
      "Breakdown:",
      `  Text Input:  ${formatCost(this.cachedTotal.textInputCost)}`,
      `  Text Output: ${formatCost(this.cachedTotal.textOutputCost)}`,
      `  Images:      ${formatCost(this.cachedTotal.imageCost)}`,
      `  --------------------------------`,
      `  TOTAL:       ${formatCost(this.cachedTotal.totalCost)}`,
      "",
      "Per-Request Details:",
    ];

    this.costs.forEach((cost, i) => {
      lines.push(
        `  Request ${(i + 1).toString()}: ${formatCost(cost.totalCost)}`,
      );
    });

    return lines.join("\n");
  }
}
