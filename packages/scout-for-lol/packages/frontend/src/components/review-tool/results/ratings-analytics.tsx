/**
 * Analytics view showing rating statistics
 */
import { useMemo, useSyncExternalStore } from "react";
import { loadHistory } from "#src/lib/review-tool/history-manager.ts";

// Store for history data
let historyData: Awaited<ReturnType<typeof loadHistory>> = [];
const historyListeners = new Set<() => void>();

function handleHistoryUpdate() {
  void loadHistoryData();
}

function subscribeToHistory(callback: () => void) {
  historyListeners.add(callback);
  // Also listen for history-update events
  globalThis.addEventListener("history-update", handleHistoryUpdate);
  return () => {
    historyListeners.delete(callback);
    globalThis.removeEventListener("history-update", handleHistoryUpdate);
  };
}

function getHistorySnapshot() {
  return historyData;
}

// Load history data at module level
let historyLoadPromise: Promise<void> | null = null;

function loadHistoryData() {
  // Always reload (don't cache the promise) so updates are reflected
  historyLoadPromise = (async () => {
    historyData = await loadHistory();
    historyListeners.forEach((listener) => {
      listener();
    });
  })();
  return historyLoadPromise;
}

// Start loading immediately
void loadHistoryData();

export function RatingsAnalytics() {
  // Subscribe to history data store
  const history = useSyncExternalStore(
    subscribeToHistory,
    getHistorySnapshot,
    getHistorySnapshot,
  );

  const statistics = useMemo(() => {
    const ratedEntries = history.filter(
      (entry) => entry.rating !== undefined && entry.status === "complete",
    );

    // Overall stats
    const totalRated = ratedEntries.length;
    const averageRating =
      totalRated > 0
        ? ratedEntries.reduce((sum, entry) => sum + (entry.rating ?? 0), 0) /
          totalRated
        : 0;

    // Rating distribution
    const ratingCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const entry of ratedEntries) {
      if (entry.rating !== undefined) {
        ratingCounts[entry.rating] = (ratingCounts[entry.rating] ?? 0) + 1;
      }
    }

    // Personality stats
    const personalityMap = new Map<string, { total: number; sum: number }>();
    for (const entry of ratedEntries) {
      const personality = entry.configSnapshot.personality;
      if (
        personality !== undefined &&
        personality.length > 0 &&
        entry.rating !== undefined
      ) {
        const existing = personalityMap.get(personality);
        if (existing) {
          existing.total += 1;
          existing.sum += entry.rating;
        } else {
          personalityMap.set(personality, { total: 1, sum: entry.rating });
        }
      }
    }

    const personalityStats = [...personalityMap.entries()]
      .map(([personality, data]) => ({
        personality,
        average: data.sum / data.total,
        count: data.total,
      }))
      .sort((a, b) => b.average - a.average);

    return {
      totalRated,
      totalGenerated: history.filter((e) => e.status === "complete").length,
      averageRating,
      ratingCounts,
      personalityStats,
    };
  }, [history]);

  if (statistics.totalRated === 0) {
    return (
      <div className="bg-scout-surface rounded-lg border border-scout-border p-8 text-center">
        <div className="text-4xl mb-3">📊</div>
        <h3 className="text-lg font-bold text-scout-ink mb-2">
          No ratings yet
        </h3>
        <p className="text-sm text-scout-subtle">
          Generate some reviews and rate them to see analytics here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-scout-surface rounded-lg border border-scout-border p-6">
        <h2 className="text-xl font-bold text-scout-ink mb-4">
          Rating Analytics
        </h2>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-4 bg-scout-raised rounded">
            <div className="text-2xl font-bold text-scout-ink">
              {statistics.totalRated}
            </div>
            <div className="text-sm text-scout-subtle">Rated Generations</div>
          </div>
          <div className="p-4 bg-scout-raised rounded">
            <div className="text-2xl font-bold text-scout-brand">
              {statistics.totalGenerated}
            </div>
            <div className="text-sm text-scout-brand">Total Generations</div>
          </div>
          <div className="p-4 bg-scout-success rounded">
            <div className="text-2xl font-bold text-scout-success-ink">
              {statistics.averageRating.toFixed(2)}
            </div>
            <div className="text-sm text-scout-success-ink">Average Rating</div>
          </div>
        </div>

        {/* Rating Distribution */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-scout-ink mb-3">
            Rating Distribution
          </h3>
          <div className="flex gap-4 items-end h-32">
            {[1, 2, 3, 4].map((rating) => {
              const count = statistics.ratingCounts[rating] ?? 0;
              const maxCount = Math.max(
                ...Object.values(statistics.ratingCounts),
              );
              const height = maxCount > 0 ? (count / maxCount) * 100 : 0;

              return (
                <div key={rating} className="flex-1 flex flex-col items-center">
                  <div
                    className="w-full bg-scout-brand rounded-t transition-all flex items-start justify-center pt-2 text-scout-brand-ink font-semibold text-sm"
                    style={{
                      height: `${height.toString()}%`,
                      minHeight: count > 0 ? "32px" : "0",
                    }}
                  >
                    {count > 0 && count}
                  </div>
                  <div className="mt-2 text-sm font-medium text-scout-subtle">
                    {rating} ⭐
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Best Personalities */}
      {statistics.personalityStats.length > 0 && (
        <div className="bg-scout-surface rounded-lg border border-scout-border p-6">
          <h3 className="text-lg font-bold text-scout-ink mb-4">
            Best Personalities
          </h3>
          <div className="space-y-2">
            {statistics.personalityStats.slice(0, 10).map((stat) => (
              <div
                key={stat.personality}
                className="flex items-center justify-between p-3 bg-scout-raised rounded"
              >
                <div className="flex-1">
                  <div className="text-sm font-medium text-scout-ink">
                    {stat.personality}
                  </div>
                  <div className="text-xs text-scout-subtle">
                    {stat.count} generations
                  </div>
                </div>
                <div className="text-lg font-bold text-scout-brand">
                  {stat.average.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
