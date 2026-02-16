/**
 * Results panel showing generated review and metadata
 */
import { useState, useSyncExternalStore } from "react";
import { z } from "zod";
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
import {
  generateMatchReview,
  type GenerationProgress as GenerationProgressType,
} from "@scout-for-lol/frontend/lib/review-tool/generator";
import { CostDisplay } from "./cost-display.tsx";
import { HistoryPanel } from "./history-panel.tsx";
import {
  createPendingEntry,
  saveCompletedEntry,
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

const ErrorSchema = z.object({ message: z.string() });

// Global timer for tracking elapsed time - updates every second
let timerTick = 0;
const timerSubscribers = new Set<() => void>();
let timerInterval: ReturnType<typeof setInterval> | null = null;

function startGlobalTimer() {
  timerInterval ??= setInterval(() => {
    timerTick += 1;
    timerSubscribers.forEach((callback) => {
      callback();
    });
  }, 1000);
}

function stopGlobalTimer() {
  if (timerInterval !== null && timerSubscribers.size === 0) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function subscribeToTimer(callback: () => void) {
  timerSubscribers.add(callback);
  startGlobalTimer();
  return () => {
    timerSubscribers.delete(callback);
    stopGlobalTimer();
  };
}

function getTimerSnapshot() {
  return timerTick;
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

type ActiveGeneration = {
  id: string;
  progress?: GenerationProgressType;
  startTime: number;
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

  // Subscribe to global timer - always active but cheap
  // This triggers a re-render every second, causing elapsed times to update
  useSyncExternalStore(subscribeToTimer, getTimerSnapshot, getTimerSnapshot);

  // Calculate elapsed times only when there are active generations
  const now = Date.now();
  const activeGenerationTimers = new Map<string, number>(
    Array.from(activeGenerations.entries()).map(([id, gen]) => [
      id,
      now - gen.startTime,
    ]),
  );

  const handleGenerate = async () => {
    // Clear any previous validation error
    setValidationError(null);

    // match, rawMatch, and rawTimeline are required for review generation
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

    // Create entry ID (not persisted yet)
    console.log("[History] Creating entry ID");
    const historyId = createPendingEntry();
    console.log("[History] Created entry ID:", historyId);

    // Build config snapshot (for saving to history later)
    const configSnapshot: HistoryEntry["configSnapshot"] = {};

    // Add to active generations
    const newGen: ActiveGeneration = {
      id: historyId,
      startTime: Date.now(),
    };
    setActiveGenerations((prev) => new Map(prev).set(historyId, newGen));
    setSelectedHistoryId(historyId);
    setViewingHistory(false); // Switch back to current result when generating

    try {
      const generatedResult = await generateMatchReview({
        match,
        rawMatch,
        rawTimeline,
        config,
        onProgress: (p) => {
          setActiveGenerations((prev) => {
            const updated = new Map(prev);
            const gen = updated.get(historyId);
            if (gen) {
              gen.progress = p;
              updated.set(historyId, gen);
            }
            return updated;
          });
        },
      });

      // Only update the displayed result if this is the selected generation
      if (selectedHistoryId === historyId) {
        onResultGenerated(generatedResult);
      }

      // Update config snapshot with actual selected values
      if (generatedResult.metadata.selectedPersonality) {
        configSnapshot.personality =
          generatedResult.metadata.selectedPersonality;
      }
      if (generatedResult.metadata.imageDescription) {
        configSnapshot.imageDescription =
          generatedResult.metadata.imageDescription;
      }

      // Save completed entry to IndexedDB
      console.log("[History] Saving completed entry:", historyId);
      await saveCompletedEntry(historyId, generatedResult, configSnapshot);
      console.log("[History] Saved, triggering refresh");

      // Calculate and track cost
      if (!generatedResult.error) {
        const cost = calculateCost(
          generatedResult.metadata,
          config.textGeneration.model,
          config.imageGeneration.model,
        );
        void (async () => {
          try {
            await costTracker.add(cost);
          } catch {
            // Error handling is done in the cost tracker
          }
        })();
      }

      // Trigger history panel refresh via history store
      // History store will be updated by the history manager
      console.log("[History] Generation complete, history should refresh");
    } catch (error) {
      const errorResult = {
        text: "",
        metadata: {
          textDurationMs: 0,
          imageGenerated: false,
        },
        error: ErrorSchema.safeParse(error).success
          ? ErrorSchema.parse(error).message
          : String(error),
      };

      // Only update displayed result if this is the selected generation
      if (selectedHistoryId === historyId) {
        onResultGenerated(errorResult);
      }

      // Save error result to history
      console.log("[History] Saving error result:", historyId);
      await saveCompletedEntry(historyId, errorResult, configSnapshot);
    } finally {
      // Remove from active generations
      setActiveGenerations((prev) => {
        const updated = new Map(prev);
        updated.delete(historyId);
        return updated;
      });
    }
  };

  const handleSelectHistoryEntry = (entry: HistoryEntry) => {
    setViewingHistory(true);
    setSelectedHistoryId(entry.id);
    setRating(entry.rating);
    setNotes(entry.notes ?? "");
    onResultGenerated(entry.result);
  };

  const handleSelectActiveGeneration = (id: string) => {
    setViewingHistory(false);
    setSelectedHistoryId(id);
  };

  const handleRatingChange = async (newRating: 1 | 2 | 3 | 4) => {
    if (!selectedHistoryId) {
      return;
    }
    setRating(newRating);
    await updateHistoryRating(selectedHistoryId, newRating, notes);
  };

  const handleNotesChange = async (newNotes: string) => {
    if (!selectedHistoryId) {
      return;
    }
    setNotes(newNotes);
    if (rating) {
      await updateHistoryRating(selectedHistoryId, rating, newNotes);
    }
  };

  const handleCancelPending = (id: string) => {
    // Pending entries are not persisted, so nothing to cancel
    console.log("[History] Cancel requested for pending entry:", id);
  };

  const cost = result?.metadata
    ? calculateCost(
        result.metadata,
        config.textGeneration.model,
        config.imageGeneration.model,
      )
    : null;

  const selectedGen = selectedHistoryId
    ? activeGenerations.get(selectedHistoryId)
    : undefined;
  const isViewingActiveGeneration = selectedGen !== undefined;
  const elapsedMs = selectedHistoryId
    ? (activeGenerationTimers.get(selectedHistoryId) ?? 0)
    : 0;

  return (
    <div className="space-y-6">
      {/* History Panel */}
      <HistoryPanel
        onSelectEntry={handleSelectHistoryEntry}
        selectedEntryId={selectedHistoryId}
        onCancelPending={handleCancelPending}
      />

      {/* Active Generations Panel */}
      <ActiveGenerationsPanel
        activeGenerations={activeGenerations}
        activeGenerationTimers={activeGenerationTimers}
        selectedHistoryId={selectedHistoryId}
        onSelectGeneration={handleSelectActiveGeneration}
      />

      {/* Current/Selected Result */}
      <div className="card p-6">
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
            {isViewingActiveGeneration && (
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
            onClick={() => {
              void (async () => {
                try {
                  await handleGenerate();
                } catch {
                  // Error handling is done in handleGenerate
                }
              })();
            }}
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

        {!match && (
          <div className="mb-4 p-4 rounded-xl bg-victory-50 border border-victory-200 text-sm text-victory-800 flex items-center gap-3">
            <svg
              className="w-5 h-5 text-victory-500 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>
              No match selected. Select a match from the browser to generate a
              review.
            </span>
          </div>
        )}

        {/* Validation Error Display */}
        {validationError && (
          <div className="mb-4 p-4 rounded-xl bg-defeat-50 border border-defeat-200 animate-fade-in">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-defeat-500 shrink-0 mt-0.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="flex-1">
                <div className="font-semibold text-defeat-900 mb-1">
                  Cannot Generate Review
                </div>
                <div className="text-sm text-defeat-700">{validationError}</div>
              </div>
              <button
                onClick={() => {
                  setValidationError(null);
                }}
                className="text-defeat-400 hover:text-defeat-600"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Selected Match & Reviewer Info */}
        <MatchAndReviewerInfo match={match} config={config} />

        {/* Generation Progress */}
        {selectedGen?.progress && (
          <GenerationProgress
            progress={selectedGen.progress}
            elapsedMs={elapsedMs}
          />
        )}

        {/* Error Display */}
        {result?.error && (
          <div className="mb-4 p-4 rounded-xl bg-defeat-50 border border-defeat-200 animate-fade-in">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-defeat-500 shrink-0 mt-0.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="flex-1">
                <div className="font-semibold text-defeat-900 mb-1">
                  Generation Failed
                </div>
                <div className="text-sm text-defeat-700">{result.error}</div>
              </div>
            </div>
          </div>
        )}

        {/* Result Display */}
        {result && !result.error && (
          <>
            <ResultDisplay result={result} />

            {/* Rating Component */}
            {selectedHistoryId && result.image && viewingHistory && (
              <ResultRating
                rating={rating}
                notes={notes}
                onRatingChange={handleRatingChange}
                onNotesChange={handleNotesChange}
              />
            )}

            {/* Metadata */}
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
        )}
      </div>

      <CostDisplay costTracker={costTracker} />
    </div>
  );
}
