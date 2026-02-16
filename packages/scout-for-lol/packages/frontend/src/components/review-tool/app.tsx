/**
 * Main application component - Redesigned UI
 */
import { useState, useSyncExternalStore } from "react";
import {
  createDefaultGlobalConfig,
  createDefaultTabConfig,
  mergeConfigs,
  splitConfig,
  type GenerationResult,
  type GlobalConfig,
  type TabConfig,
} from "@scout-for-lol/frontend/lib/review-tool/config/schema";
import {
  loadCurrentConfig,
  saveCurrentConfig,
  loadGlobalConfig,
  saveGlobalConfig,
} from "@scout-for-lol/frontend/lib/review-tool/config-manager";
import { CostTracker } from "@scout-for-lol/frontend/lib/review-tool/costs";
import { migrateFromLocalStorage } from "@scout-for-lol/frontend/lib/review-tool/storage";
import { AppHeader } from "./app-header.tsx";
import { ConfigModal } from "./config-modal.tsx";
import { SettingsPanel } from "./settings-panel.tsx";
import { ResultsPanel } from "./results-panel.tsx";
import { MatchBrowser } from "./match-browser.tsx";
import { MatchDetailsPanel } from "./match-details-panel.tsx";
import { RankConfigPanel, createDefaultRankConfig, type RankConfig } from "./rank-config-panel.tsx";
import { RatingsAnalytics } from "./ratings-analytics.tsx";
import { Spinner } from "./ui/spinner.tsx";
import type { CompletedMatch, ArenaMatch, RawMatch, RawTimeline } from "@scout-for-lol/data";

// Store for app initialization state
type AppInitState = {
  globalConfig: GlobalConfig;
  config: TabConfig;
  isInitialized: boolean;
};

// Current match state (kept separate from persisted config)
type MatchState = {
  match?: CompletedMatch | ArenaMatch;
  rawMatch?: RawMatch;
  rawTimeline?: RawTimeline;
  result?: GenerationResult;
  rankConfig: RankConfig;
};

let appInitState: AppInitState = {
  globalConfig: createDefaultGlobalConfig(),
  config: createDefaultTabConfig(),
  isInitialized: false,
};

const appInitListeners = new Set<() => void>();

function subscribeToAppInit(callback: () => void) {
  appInitListeners.add(callback);
  return () => {
    appInitListeners.delete(callback);
  };
}

function getAppInitSnapshot() {
  return appInitState;
}

// Module-level initialization - runs once per app load
let appInitPromise: Promise<void> | null = null;

function initializeAppData() {
  appInitPromise ??= (async () => {
    try {
      // First, migrate any localStorage data to IndexedDB
      await migrateFromLocalStorage();

      // Then load from IndexedDB
      let globalConfig = await loadGlobalConfig();
      if (!globalConfig) {
        // Try migrating from old merged config
        const oldConfig = await loadCurrentConfig();
        if (oldConfig) {
          const { global } = splitConfig(oldConfig);
          globalConfig = global;
        } else {
          globalConfig = createDefaultGlobalConfig();
        }
      }

      // Load config
      let config: TabConfig;
      const oldConfig = await loadCurrentConfig();
      if (oldConfig) {
        const { tab } = splitConfig(oldConfig);
        config = tab;
      } else {
        config = createDefaultTabConfig();
      }

      // Create new object reference to trigger useSyncExternalStore update
      appInitState = {
        globalConfig,
        config,
        isInitialized: true,
      };
      appInitListeners.forEach((listener) => {
        listener();
      });
    } catch (error) {
      console.error("Failed to initialize app:", error);
      // Still update state even on error so component can render
      appInitState.isInitialized = true;
      appInitListeners.forEach((listener) => {
        listener();
      });
      throw error;
    }
  })();
  return appInitPromise;
}

// Start initialization immediately
void initializeAppData();

export default function App() {
  // Subscribe to app initialization state
  const initState = useSyncExternalStore(subscribeToAppInit, getAppInitSnapshot, getAppInitSnapshot);
  const { globalConfig, config, isInitialized } = initState;

  const [matchState, setMatchState] = useState<MatchState>({
    rankConfig: createDefaultRankConfig(),
  });
  const [costTracker] = useState(() => new CostTracker());
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Show loading state while initializing
  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center">
        <div className="card p-8 flex flex-col items-center gap-4 animate-fade-in">
          <Spinner size="lg" className="text-brand-500" />
          <p className="text-surface-600 font-medium">Loading configuration...</p>
        </div>
      </div>
    );
  }

  // Wrapper to save global config when it changes
  const updateGlobalConfig = (newGlobalConfig: GlobalConfig) => {
    appInitState = { ...appInitState, globalConfig: newGlobalConfig };
    appInitListeners.forEach((listener) => {
      listener();
    });
    // Save config when it changes
    void saveGlobalConfig(newGlobalConfig);
  };

  const updateConfig = (newConfig: TabConfig) => {
    appInitState = { ...appInitState, config: newConfig };
    appInitListeners.forEach((listener) => {
      listener();
    });
    // Save config when it changes
    const merged = mergeConfigs(globalConfig, newConfig);
    void saveCurrentConfig(merged);
  };

  const updateResult = (result: GenerationResult) => {
    setMatchState((prev) => ({ ...prev, result }));
  };

  const updateMatch = (match: CompletedMatch | ArenaMatch, rawMatch: RawMatch, rawTimeline: RawTimeline | null) => {
    setMatchState((prev) => {
      const newState: MatchState = {
        match,
        rawMatch,
        rankConfig: prev.rankConfig,
      };
      if (rawTimeline) {
        newState.rawTimeline = rawTimeline;
      }
      return newState;
    });
  };

  const updateRankConfig = (rankConfig: RankConfig) => {
    setMatchState((prev) => ({ ...prev, rankConfig }));
  };

  // Apply rank overrides to match if enabled
  const getMatchWithRankOverrides = (): CompletedMatch | ArenaMatch | undefined => {
    if (!matchState.match) {
      return undefined;
    }
    if (!matchState.rankConfig.enabled) {
      return matchState.match;
    }

    // Only apply to non-arena matches (arena doesn't have ranks)
    if (matchState.match.queueType === "arena") {
      return matchState.match;
    }

    // Clone and override rank data for first player
    const match = matchState.match;
    const updatedPlayers = match.players.map((player, idx) => {
      if (idx === 0) {
        return {
          ...player,
          rankBeforeMatch: matchState.rankConfig.rankBefore,
          rankAfterMatch: matchState.rankConfig.rankAfter,
        };
      }
      return player;
    });

    return { ...match, players: updatedPlayers };
  };

  return (
    <div className="min-h-screen bg-surface-50 bg-hero-pattern">
      {/* Header */}
      <AppHeader
        showAnalytics={showAnalytics}
        onSettingsClick={() => {
          setShowConfigModal(true);
        }}
        onAnalyticsToggle={() => {
          setShowAnalytics(!showAnalytics);
        }}
      />

      {/* Main content area */}
      <main className="max-w-[1800px] mx-auto px-6 py-8">
        {showAnalytics ? (
          <div className="animate-fade-in">
            <RatingsAnalytics />
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 animate-fade-in">
            {/* Left column - Match selection & settings */}
            <div className="space-y-6">
              {/* Match Browser */}
              <section className="card p-0 overflow-hidden">
                <div className="px-6 py-4 border-b border-surface-200/50">
                  <h2 className="text-lg font-semibold text-surface-900">Browse Matches</h2>
                  <p className="text-sm text-surface-500 mt-0.5">Select a match to generate a review</p>
                </div>
                <MatchBrowser
                  onMatchSelected={(match, rawMatch, rawTimeline) => {
                    updateMatch(match, rawMatch, rawTimeline);
                  }}
                  apiSettings={globalConfig.api}
                />
              </section>

              {/* Selected Match Details */}
              {matchState.match && (
                <section className="animate-slide-up">
                  <MatchDetailsPanel match={matchState.match} hasTimeline={matchState.rawTimeline !== undefined} />
                </section>
              )}

              {/* Rank Context Override */}
              {matchState.match && matchState.match.queueType !== "arena" && (
                <section className="animate-slide-up">
                  <RankConfigPanel config={matchState.rankConfig} onChange={updateRankConfig} />
                </section>
              )}

              {/* Generation Settings */}
              <section>
                <SettingsPanel config={config} onChange={updateConfig} />
              </section>
            </div>

            {/* Right column - Results */}
            <div className="space-y-6">
              <ResultsPanel
                config={mergeConfigs(globalConfig, config)}
                match={getMatchWithRankOverrides()}
                rawMatch={matchState.rawMatch}
                rawTimeline={matchState.rawTimeline}
                result={matchState.result}
                costTracker={costTracker}
                onResultGenerated={updateResult}
              />
            </div>
          </div>
        )}
      </main>

      {/* API Configuration Modal */}
      <ConfigModal
        isOpen={showConfigModal}
        onClose={() => {
          setShowConfigModal(false);
        }}
        globalConfig={globalConfig}
        onGlobalChange={updateGlobalConfig}
      />
    </div>
  );
}
