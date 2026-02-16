/**
 * Result metadata display (pipeline timing, prompts, cost breakdown)
 */
import type {
  GenerationResult,
  CostBreakdown,
  PipelineTraces,
  StageTrace,
} from "@scout-for-lol/frontend/lib/review-tool/config/schema";
import {
  formatCost,
  calculatePipelineCosts,
  type PipelineCostBreakdown,
  type StageCost,
} from "@scout-for-lol/frontend/lib/review-tool/costs";
import { useMemo } from "react";

type ResultMetadataProps = {
  result: GenerationResult;
  cost: CostBreakdown | null;
  imageModel?: string;
};

type GenerationMetadata = GenerationResult["metadata"];

// ============================================================================
// Cost Display Components
// ============================================================================

function StageCostRow({ label, stageCost }: { label: string; stageCost: StageCost }) {
  return (
    <div className="flex justify-between items-start">
      <span className="text-surface-600 dark:text-surface-400">{label}:</span>
      <div className="text-right">
        <span className="font-mono text-surface-900 dark:text-surface-100">{formatCost(stageCost.totalCost)}</span>
        <div className="text-xs text-surface-500 dark:text-surface-500 font-mono">
          in: {formatCost(stageCost.inputCost)} / out: {formatCost(stageCost.outputCost)}
        </div>
      </div>
    </div>
  );
}

function PipelineCostDisplay({ costs }: { costs: PipelineCostBreakdown }) {
  return (
    <>
      {costs.timelineSummary && <StageCostRow label="Timeline Summary" stageCost={costs.timelineSummary} />}
      {costs.matchSummary && <StageCostRow label="Match Summary" stageCost={costs.matchSummary} />}
      {costs.reviewText && <StageCostRow label="Review Text" stageCost={costs.reviewText} />}
      {costs.imageDescription && <StageCostRow label="Image Description" stageCost={costs.imageDescription} />}
      {costs.imageGeneration && costs.imageGeneration.cost > 0 && (
        <div className="flex justify-between">
          <span className="text-surface-600 dark:text-surface-400">Image Generation:</span>
          <span className="font-mono text-surface-900 dark:text-surface-100">
            {formatCost(costs.imageGeneration.cost)}
          </span>
        </div>
      )}
      <div className="flex justify-between border-t border-surface-200 dark:border-surface-700 pt-2">
        <span className="font-semibold text-surface-900 dark:text-white">Total:</span>
        <span className="font-mono font-bold text-brand-600 dark:text-brand-400">
          {formatCost(costs.total.totalCost)}
        </span>
      </div>
    </>
  );
}

function LegacyCostDisplay({ cost }: { cost: CostBreakdown }) {
  return (
    <>
      <div className="flex justify-between">
        <span className="text-surface-600 dark:text-surface-400">Text Input:</span>
        <span className="font-mono text-surface-900 dark:text-surface-100">{formatCost(cost.textInputCost)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-surface-600 dark:text-surface-400">Text Output:</span>
        <span className="font-mono text-surface-900 dark:text-surface-100">{formatCost(cost.textOutputCost)}</span>
      </div>
      {cost.imageCost > 0 && (
        <div className="flex justify-between">
          <span className="text-surface-600 dark:text-surface-400">Image:</span>
          <span className="font-mono text-surface-900 dark:text-surface-100">{formatCost(cost.imageCost)}</span>
        </div>
      )}
      <div className="flex justify-between border-t border-surface-200 dark:border-surface-700 pt-2">
        <span className="font-semibold text-surface-900 dark:text-white">Total:</span>
        <span className="font-mono font-bold text-brand-600 dark:text-brand-400">{formatCost(cost.totalCost)}</span>
      </div>
    </>
  );
}

// ============================================================================
// Timing Display Components
// ============================================================================

function StageTimingRow({ label, trace }: { label: string; trace: StageTrace }) {
  const hasTokens = trace.tokensPrompt !== undefined || trace.tokensCompletion !== undefined;
  return (
    <div className="flex justify-between items-center">
      <span className="text-surface-600 dark:text-surface-400">{label}:</span>
      <span className="font-mono text-surface-900 dark:text-surface-100 text-right">
        {trace.durationMs.toLocaleString()}ms
        {hasTokens && (
          <span className="text-xs text-surface-500 ml-2">
            ({trace.tokensPrompt?.toLocaleString() ?? "?"} → {trace.tokensCompletion?.toLocaleString() ?? "?"})
          </span>
        )}
      </span>
    </div>
  );
}

function ImageGenTimingRow({ durationMs }: { durationMs: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-surface-600 dark:text-surface-400">Image Generation:</span>
      <span className="font-mono text-surface-900 dark:text-surface-100">{durationMs.toLocaleString()}ms</span>
    </div>
  );
}

function sumValues(values: (number | undefined)[]): number {
  let sum = 0;
  for (const v of values) {
    if (v !== undefined) {
      sum += v;
    }
  }
  return sum;
}

function PipelineTimingTotals({ traces }: { traces: PipelineTraces }) {
  const duration = sumValues([
    traces.timelineSummary?.durationMs,
    traces.matchSummary?.durationMs,
    traces.reviewText.durationMs,
    traces.imageDescription?.durationMs,
    traces.imageGeneration?.durationMs,
  ]);

  const promptTokens = sumValues([
    traces.timelineSummary?.tokensPrompt,
    traces.matchSummary?.tokensPrompt,
    traces.reviewText.tokensPrompt,
    traces.imageDescription?.tokensPrompt,
  ]);

  const completionTokens = sumValues([
    traces.timelineSummary?.tokensCompletion,
    traces.matchSummary?.tokensCompletion,
    traces.reviewText.tokensCompletion,
    traces.imageDescription?.tokensCompletion,
  ]);

  return (
    <div className="flex justify-between border-t border-surface-200 dark:border-surface-700 pt-2">
      <span className="font-semibold text-surface-900 dark:text-white">Total:</span>
      <span className="font-mono text-surface-900 dark:text-surface-100 text-right">
        {duration.toLocaleString()}ms
        <span className="text-xs text-surface-500 ml-2">
          ({promptTokens.toLocaleString()} → {completionTokens.toLocaleString()})
        </span>
      </span>
    </div>
  );
}

function PipelineTimingDisplay({ traces }: { traces: PipelineTraces }) {
  return (
    <>
      {traces.timelineSummary && <StageTimingRow label="Timeline Summary" trace={traces.timelineSummary} />}
      {traces.matchSummary && <StageTimingRow label="Match Summary" trace={traces.matchSummary} />}
      <StageTimingRow label="Review Text" trace={traces.reviewText} />
      {traces.imageDescription && <StageTimingRow label="Image Description" trace={traces.imageDescription} />}
      {traces.imageGeneration && <ImageGenTimingRow durationMs={traces.imageGeneration.durationMs} />}
      <PipelineTimingTotals traces={traces} />
    </>
  );
}

function LegacyTimingDisplay({ metadata }: { metadata: GenerationMetadata }) {
  return (
    <>
      <div className="flex justify-between">
        <span className="text-surface-600 dark:text-surface-400">Text Generation:</span>
        <span className="font-mono text-surface-900 dark:text-surface-100">{metadata.textDurationMs}ms</span>
      </div>
      {metadata.textTokensPrompt !== undefined && (
        <div className="flex justify-between">
          <span className="text-surface-600 dark:text-surface-400">Prompt Tokens:</span>
          <span className="font-mono text-surface-900 dark:text-surface-100">{metadata.textTokensPrompt}</span>
        </div>
      )}
      {metadata.textTokensCompletion !== undefined && (
        <div className="flex justify-between">
          <span className="text-surface-600 dark:text-surface-400">Completion Tokens:</span>
          <span className="font-mono text-surface-900 dark:text-surface-100">{metadata.textTokensCompletion}</span>
        </div>
      )}
      {metadata.imageGenerated && metadata.imageDurationMs !== undefined && (
        <div className="flex justify-between">
          <span className="text-surface-600 dark:text-surface-400">Image Generation:</span>
          <span className="font-mono text-surface-900 dark:text-surface-100">{metadata.imageDurationMs}ms</span>
        </div>
      )}
    </>
  );
}

// ============================================================================
// Context Display Component
// ============================================================================

function ContextDisplay({ metadata }: { metadata: GenerationMetadata }) {
  const hasContext =
    metadata.selectedPersonality !== undefined ||
    metadata.intermediate?.selectedArtStyle !== undefined ||
    metadata.imageDescription !== undefined;

  if (!hasContext) {
    return null;
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-2">Context</h3>
      <div className="space-y-2 text-sm">
        {metadata.selectedPersonality && (
          <div className="flex justify-between">
            <span className="text-surface-600 dark:text-surface-400">Personality:</span>
            <span className="font-mono text-surface-900 dark:text-surface-100">{metadata.selectedPersonality}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Prompt Display Components
// ============================================================================

function OpenAIParamsSection({ params }: { params: unknown }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-2">OpenAI Request Parameters</h3>
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200 list-none">
          <span className="inline-flex items-center gap-1">
            <svg
              className="w-4 h-4 transition-transform group-open:rotate-90"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Full Request Object (JSON)
          </span>
        </summary>
        <div className="mt-2 p-3 bg-surface-50 dark:bg-surface-800 rounded border border-surface-200 dark:border-surface-700 font-mono text-xs text-surface-900 dark:text-surface-100 whitespace-pre-wrap max-h-96 overflow-y-auto">
          {JSON.stringify(params, null, 2)}
        </div>
      </details>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ResultMetadata({ result, cost, imageModel }: ResultMetadataProps) {
  const pipelineCosts = useMemo((): PipelineCostBreakdown | null => {
    if (!result.metadata.traces) {
      return null;
    }
    return calculatePipelineCosts(result.metadata.traces, imageModel ?? "gemini-2.0-flash");
  }, [result.metadata.traces, imageModel]);

  const { metadata } = result;
  const { traces } = metadata;
  const hasCost = pipelineCosts !== null || cost !== null;

  return (
    <div className="space-y-4">
      {/* Pipeline Timing */}
      <div>
        <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-2">Pipeline Timing</h3>
        <div className="space-y-2 text-sm">
          {traces !== undefined ? (
            <PipelineTimingDisplay traces={traces} />
          ) : (
            <LegacyTimingDisplay metadata={metadata} />
          )}
        </div>
      </div>

      {/* Context */}
      <ContextDisplay metadata={metadata} />

      {/* OpenAI Params */}
      {metadata.openaiRequestParams !== undefined && metadata.openaiRequestParams !== null && (
        <OpenAIParamsSection params={metadata.openaiRequestParams} />
      )}

      {/* Cost */}
      {hasCost && (
        <div>
          <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-2">Cost</h3>
          <div className="space-y-2 text-sm">
            {pipelineCosts !== null ? (
              <PipelineCostDisplay costs={pipelineCosts} />
            ) : cost !== null ? (
              <LegacyCostDisplay cost={cost} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
