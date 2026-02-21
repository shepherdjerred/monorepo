/**
 * Results panel showing generated review and metadata
 */
import { useState, useSyncExternalStore } from "react";
import type {
  ReviewConfig,
  GenerationResult,
} from "@scout-for-lol/frontend/lib/review-tool/config/schema";
import type {
  CompletedMatch,
  ArenaMatch,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data";
import type { CostTracker } from "@scout-for-lol/frontend/lib/review-tool/costs";
import { calculateCost } from "@scout-for-lol/frontend/lib/review-tool/costs";
import type { GenerationProgress as GenerationProgressType } from "@scout-for-lol/frontend/lib/review-tool/generator";
import { CostDisplay } from "./cost-display.tsx";
import { HistoryPanel } from "./history-panel.tsx";
import {
  createPendingEntry,
  updateHistoryRating,
  type HistoryEntry,
} from "@scout-for-lol/frontend/lib/review-tool/history-manager";
import { ActiveGenerationsPanel } from "./active-generations-panel.tsx";
import { GenerationProgress } from "./generation-progress.tsx";
import { ResultDisplay } from "./result-display.tsx";
import { ResultMetadata } from "./result-metadata.tsx";
import { ResultRating } from "./result-rating.tsx";
import { PipelineTracesPanel } from "./pipeline-traces-panel.tsx";
import { MatchAndReviewerInfo } from "./match-reviewer-info.tsx";
import {
  subscribeToTimer,
  getTimerSnapshot,
  type ActiveGeneration,
} from "./results-panel-timer.ts";
import {
  ValidationErrorAlert,
  GenerationErrorAlert,
  NoMatchInfoBox,
} from "./results-panel-alerts.tsx";
import {
  handleCancelPending,
  executeGeneration,
} from "./results-panel-utils.ts";

function ReviewHeader({
  viewingHistory,
  isGenerating,
  onGenerate,
}: {
  viewingHistory: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="flex justify-between items-start mb-6">
      <div>
        <h2 className="text-xl font-semibold text-surface-900">
          Generated Review
        </h2>
        {viewingHistory && (
          <p className="text-xs text-surface-500 mt-1 flex items-center gap-1">
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Viewing from history
          </p>
        )}
        {isGenerating && (
          <p className="text-xs text-victory-600 mt-1 flex items-center gap-1">
            <svg
              className="w-3 h-3 animate-spin"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Generating...
          </p>
        )}
      </div>
      <button
        onClick={onGenerate}
        className="flex items-center gap-2 px-5 py-2.5 bg-black text-white hover:bg-brand-700 text-black font-semibold rounded-lg shadow-md hover:shadow-lg transition-all duration-200 active:scale-95"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
        Generate Review
      </button>
    </div>
  );
}

function SuccessResultContent({
  result,
  selectedHistoryId,
  viewingHistory,
  rating,
  notes,
  cost,
  config,
  onRatingChange,
  onNotesChange,
}: {
  result: GenerationResult;
  selectedHistoryId: string | undefined;
  viewingHistory: boolean;
  rating: 1 | 2 | 3 | 4 | undefined;
  notes: string;
  cost: ReturnType<typeof calculateCost> | null;
  config: ReviewConfig;
  onRatingChange: (rating: 1 | 2 | 3 | 4) => Promise<void>;
  onNotesChange: (notes: string) => Promise<void>;
}) {
  const showRating =
    selectedHistoryId !== undefined &&
    selectedHistoryId.length > 0 &&
    result.image !== undefined &&
    result.image.length > 0 &&
    viewingHistory;

  return (
    <>
      <ResultDisplay result={result} />
      {showRating && (
        <ResultRating
          rating={rating}
          notes={notes}
          onRatingChange={onRatingChange}
          onNotesChange={onNotesChange}
        />
      )}
      <ResultMetadata
        result={result}
        cost={cost}
        imageModel={config.imageGeneration.model}
      />
      <div className="mt-4 space-y-2 rounded-xl border border-surface-200/50 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-surface-900">
              Pipeline traces
            </div>
            <p className="text-xs text-surface-500">
              Raw prompts, responses, and timings from each stage.
            </p>
          </div>
        </div>
        <PipelineTracesPanel
          traces={result.metadata.traces}
          intermediate={result.metadata.intermediate}
        />
      </div>
    </>
  );
}

type ResultsPanelProps = {
  config: ReviewConfig;
  match?: CompletedMatch | ArenaMatch | undefined;
  rawMatch?: RawMatch | undefined;
  rawTimeline?: RawTimeline | undefined;
  result?: GenerationResult | undefined;
  costTracker: CostTracker;
  onResultGenerated: (result: GenerationResult) => void;
};

export function ResultsPanel(props: ResultsPanelProps) {
  const {
    config,
    match,
    rawMatch,
    rawTimeline,
    result,
    costTracker,
    onResultGenerated,
  } = props;
  const [activeGenerations, setActiveGenerations] = useState<
    Map<string, ActiveGeneration>
  >(new Map());
  const [selectedHistoryId, setSelectedHistoryId] = useState<
    string | undefined
  >();
  const [viewingHistory, setViewingHistory] = useState(false);
  const [rating, setRating] = useState<1 | 2 | 3 | 4 | undefined>();
  const [notes, setNotes] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useSyncExternalStore(subscribeToTimer, getTimerSnapshot, getTimerSnapshot);

  const now = Date.now();
  const activeGenerationTimers = new Map<string, number>(
    [...activeGenerations.entries()].map(([id, gen]) => [
      id,
      now - gen.startTime,
    ]),
  );

  const handleGenerate = async () => {
    setValidationError(null);

    if (!match || !rawMatch) {
      setValidationError(
        "Please select a match first. Browse and click on a match from the list.",
      );
      return;
    }

    if (!rawTimeline) {
      setValidationError(
        "Timeline data is missing for this match. Try selecting a different match.",
      );
      return;
    }

    const historyId = createPendingEntry();
    const newGen: ActiveGeneration = { id: historyId, startTime: Date.now() };
    setActiveGenerations((prev) => new Map(prev).set(historyId, newGen));
    setSelectedHistoryId(historyId);
    setViewingHistory(false);

    try {
      await executeGeneration({
        match,
        rawMatch,
        rawTimeline,
        config,
        historyId,
        selectedHistoryId,
        costTracker,
        onResultGenerated,
        onProgressUpdate: (hId: string, p: GenerationProgressType) => {
          setActiveGenerations((prev) => {
            const updated = new Map(prev);
            const gen = updated.get(hId);
            if (gen) {
              gen.progress = p;
              updated.set(hId, gen);
            }
            return updated;
          });
        },
      });
    } finally {
      setActiveGenerations((prev) => {
        const updated = new Map(prev);
        updated.delete(historyId);
        return updated;
      });
    }
  };

  const handleRatingChange = async (newRating: 1 | 2 | 3 | 4) => {
    if (selectedHistoryId === undefined) {
      return;
    }
    setRating(newRating);
    await updateHistoryRating(selectedHistoryId, newRating, notes);
  };

  const handleNotesChange = async (newNotes: string) => {
    if (selectedHistoryId === undefined) {
      return;
    }
    setNotes(newNotes);
    if (rating) {
      await updateHistoryRating(selectedHistoryId, rating, newNotes);
    }
  };

  const cost = result?.metadata
    ? calculateCost(
        result.metadata,
        config.textGeneration.model,
        config.imageGeneration.model,
      )
    : null;

  const selectedGen =
    selectedHistoryId !== undefined && selectedHistoryId.length > 0
      ? activeGenerations.get(selectedHistoryId)
      : undefined;
  const elapsedMs =
    selectedHistoryId !== undefined && selectedHistoryId.length > 0
      ? (activeGenerationTimers.get(selectedHistoryId) ?? 0)
      : 0;

  const triggerGenerate = () => {
    void (async () => {
      try {
        await handleGenerate();
      } catch {
        /* handled internally */
      }
    })();
  };

  return (
    <div className="space-y-6">
      <HistoryPanel
        onSelectEntry={(entry: HistoryEntry) => {
          setViewingHistory(true);
          setSelectedHistoryId(entry.id);
          setRating(entry.rating);
          setNotes(entry.notes ?? "");
          onResultGenerated(entry.result);
        }}
        selectedEntryId={selectedHistoryId}
        onCancelPending={handleCancelPending}
      />
      <ActiveGenerationsPanel
        activeGenerations={activeGenerations}
        activeGenerationTimers={activeGenerationTimers}
        selectedHistoryId={selectedHistoryId}
        onSelectGeneration={(id: string) => {
          setViewingHistory(false);
          setSelectedHistoryId(id);
        }}
      />
      <div className="card p-6">
        <ReviewHeader
          viewingHistory={viewingHistory}
          isGenerating={selectedGen !== undefined}
          onGenerate={triggerGenerate}
        />
        {!match && <NoMatchInfoBox />}
        {validationError !== null && validationError.length > 0 && (
          <ValidationErrorAlert
            error={validationError}
            onDismiss={() => {
              setValidationError(null);
            }}
          />
        )}
        <MatchAndReviewerInfo match={match} config={config} />
        {selectedGen?.progress && (
          <GenerationProgress
            progress={selectedGen.progress}
            elapsedMs={elapsedMs}
          />
        )}
        {result?.error !== undefined && result.error.length > 0 && (
          <GenerationErrorAlert error={result.error} />
        )}
        {result && result.error === undefined && (
          <SuccessResultContent
            result={result}
            selectedHistoryId={selectedHistoryId}
            viewingHistory={viewingHistory}
            rating={rating}
            notes={notes}
            cost={cost}
            config={config}
            onRatingChange={handleRatingChange}
            onNotesChange={handleNotesChange}
          />
        )}
      </div>
      <CostDisplay costTracker={costTracker} />
    </div>
  );
}
