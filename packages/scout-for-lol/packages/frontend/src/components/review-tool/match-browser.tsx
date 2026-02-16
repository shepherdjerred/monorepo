/**
 * S3 match browser for selecting real match data
 */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { z } from "zod";
import Fuse, { type FuseResult } from "fuse.js";
import type { ApiSettings } from "@scout-for-lol/frontend/lib/review-tool/config/schema";
import type { CompletedMatch, ArenaMatch, RawMatch, RawTimeline } from "@scout-for-lol/data";
import {
  listMatchesFromS3,
  fetchMatchFromS3,
  fetchTimelineFromS3,
  type S3Config,
} from "@scout-for-lol/frontend/lib/review-tool/s3";
import {
  convertRawMatchToInternalFormat,
  extractMatchMetadataFromRawMatch,
  type MatchMetadata,
} from "@scout-for-lol/frontend/lib/review-tool/match-converter";
import { getCachedDataAsync, setCachedData } from "@scout-for-lol/frontend/lib/review-tool/cache";
import { MatchFilters } from "./match-filters.tsx";
import { MatchList } from "./match-list.tsx";
import { MatchPagination } from "./match-pagination.tsx";
import { MatchLoadingState } from "./match-loading-state.tsx";
import { Button } from "./ui/button.tsx";
import { EmptyState, CloudIcon, SearchIcon } from "./ui/empty-state.tsx";

const ErrorSchema = z.object({ message: z.string() });
const MatchMetadataArraySchema = z.array(
  z.object({
    key: z.string(),
    queueType: z.string(),
    playerName: z.string(),
    champion: z.string(),
    lane: z.string(),
    outcome: z.string(),
    kda: z.string(),
    timestamp: z.date(),
  }),
);

type MatchBrowserProps = {
  onMatchSelected: (match: CompletedMatch | ArenaMatch, rawMatch: RawMatch, rawTimeline: RawTimeline | null) => void;
  apiSettings: ApiSettings;
};

export function MatchBrowser({ onMatchSelected, apiSettings }: MatchBrowserProps) {
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<{ current: number; total: number } | null>(null);
  const [matches, setMatches] = useState<MatchMetadata[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filterQueueType, setFilterQueueType] = useState<string>("all");
  const [filterLane, setFilterLane] = useState<string>("all");
  const [filterPlayer, setFilterPlayer] = useState<string>("");
  const [filterChampion, setFilterChampion] = useState<string>("");
  const [filterOutcome, setFilterOutcome] = useState<string>("all");
  const [selectedMetadata, setSelectedMetadata] = useState<MatchMetadata | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const s3Config = useMemo<S3Config | null>(() => {
    if (apiSettings.s3BucketName && apiSettings.awsAccessKeyId && apiSettings.awsSecretAccessKey) {
      return {
        bucketName: apiSettings.s3BucketName,
        accessKeyId: apiSettings.awsAccessKeyId,
        secretAccessKey: apiSettings.awsSecretAccessKey,
        region: apiSettings.awsRegion,
        ...(apiSettings.s3Endpoint ? { endpoint: apiSettings.s3Endpoint } : {}),
      };
    }
    return null;
  }, [apiSettings]);

  // Track if we've already attempted auto-fetch to avoid duplicate calls
  const hasAttemptedAutoFetch = useRef(false);

  const handleBrowse = useCallback(
    async (forceRefresh = false) => {
      if (!s3Config) {
        setError("S3 credentials not configured");
        return;
      }

      // Check cache FIRST before showing loading UI
      const cacheKey = {
        bucketName: s3Config.bucketName,
        region: s3Config.region,
        endpoint: s3Config.endpoint,
        type: "metadata-array",
      };

      if (!forceRefresh) {
        const cached: unknown = await getCachedDataAsync("match-metadata", cacheKey);
        const cachedResult = MatchMetadataArraySchema.safeParse(cached);

        if (cachedResult.success && cachedResult.data.length > 0) {
          // Instant load from cache - no loading UI!
          console.log(`[Cache HIT] Loaded ${cachedResult.data.length.toString()} matches from cache (IndexedDB)`);
          setMatches(cachedResult.data);
          setError(null);
          return;
        } else {
          console.log(`[Cache MISS] Need to fetch matches`, { forceRefresh, hasCachedData: !!cached });
        }
      }

      // No cache hit, proceed with fetching
      // Cancel any ongoing fetch
      if (abortController) {
        abortController.abort();
      }

      const newAbortController = new AbortController();
      setAbortController(newAbortController);
      setLoading(true);
      setError(null);
      setMatches([]); // Clear old results while loading
      setLoadingProgress(null);

      try {
        // Not cached, need to fetch and extract
        const matchKeys = await listMatchesFromS3(s3Config);
        const matchData: MatchMetadata[] = [];

        // Fetch and convert all matches
        const totalMatches = matchKeys.length;
        setLoadingProgress({ current: 0, total: totalMatches });

        // Batch fetching with concurrency limit to avoid DOSing the endpoint
        const BATCH_SIZE = 10; // Fetch 10 matches at a time

        for (let i = 0; i < totalMatches; i += BATCH_SIZE) {
          // Check if aborted
          if (newAbortController.signal.aborted) {
            throw new Error("Loading cancelled");
          }

          const batch = matchKeys.slice(i, Math.min(i + BATCH_SIZE, totalMatches));

          // Fetch batch in parallel
          const batchResults = await Promise.allSettled(
            batch.map(async (matchKey) => {
              const rawMatch = await fetchMatchFromS3(s3Config, matchKey.key);
              if (rawMatch) {
                return extractMatchMetadataFromRawMatch(rawMatch, matchKey.key);
              }
              return null;
            }),
          );

          // Process batch results
          for (const result of batchResults) {
            if (result.status === "fulfilled" && result.value) {
              matchData.push(...result.value);
            }
          }

          // Update progress
          setLoadingProgress({ current: Math.min(i + BATCH_SIZE, totalMatches), total: totalMatches });

          // Small delay between batches to be nice to the API
          if (i + BATCH_SIZE < totalMatches) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        // Cache the metadata array for fast subsequent loads (24 hour TTL)
        console.log(`[Cache WRITE] Caching ${matchData.length.toString()} matches for 24 hours`);
        await setCachedData("match-metadata", cacheKey, matchData, 24 * 60 * 60 * 1000);

        setMatches(matchData);
        setLoadingProgress(null);
      } catch (err) {
        const errorResult = ErrorSchema.safeParse(err);
        if (errorResult.success && errorResult.data.message === "Loading cancelled") {
          setError("Loading cancelled");
        } else {
          setError(errorResult.success ? errorResult.data.message : String(err));
        }
      } finally {
        setLoading(false);
        setLoadingProgress(null);
        setAbortController(null);
      }
    },
    [s3Config, abortController],
  );

  // Auto-fetch matches on mount when s3Config is available
  // eslint-disable-next-line custom-rules/no-use-effect -- ok for now
  useEffect(() => {
    if (s3Config && !hasAttemptedAutoFetch.current) {
      hasAttemptedAutoFetch.current = true;
      void handleBrowse(false); // Use cache if available
    }
  }, [s3Config, handleBrowse]);

  const handleSelectMatch = async (metadata: MatchMetadata) => {
    if (!s3Config) {
      return;
    }

    setLoading(true);
    setSelectedMetadata(metadata);
    try {
      // Fetch match and timeline in parallel
      const [rawMatch, rawTimeline] = await Promise.all([
        fetchMatchFromS3(s3Config, metadata.key),
        fetchTimelineFromS3(s3Config, metadata.key),
      ]);

      if (rawMatch) {
        const match = convertRawMatchToInternalFormat(rawMatch, metadata.playerName);
        onMatchSelected(match, rawMatch, rawTimeline);
      }
    } catch (err) {
      const errorResult = ErrorSchema.safeParse(err);
      setError(errorResult.success ? errorResult.data.message : String(err));
      setSelectedMetadata(null);
    } finally {
      setLoading(false);
    }
  };

  const filteredMatches = useMemo(() => {
    let result = matches;

    // Queue type filter
    if (filterQueueType !== "all") {
      result = result.filter((m) => m.queueType === filterQueueType);
    }

    // Lane filter
    if (filterLane !== "all") {
      result = result.filter((m) => m.lane === filterLane);
    }

    // Outcome filter
    if (filterOutcome !== "all") {
      result = result.filter((m) => {
        if (filterOutcome === "victory") {
          return m.outcome.includes("Victory");
        }
        if (filterOutcome === "defeat") {
          return m.outcome.includes("Defeat");
        }
        return true;
      });
    }

    // Player name fuzzy filter
    if (filterPlayer.trim()) {
      const fuse = new Fuse(result, {
        keys: ["playerName"],
        threshold: 0.3, // Lower = more strict, higher = more fuzzy
        ignoreLocation: true,
        includeScore: true,
      });
      const fuzzyResults = fuse.search(filterPlayer.trim());
      result = fuzzyResults.map((r: FuseResult<MatchMetadata>) => r.item);
    }

    // Champion fuzzy filter
    if (filterChampion.trim()) {
      const fuse = new Fuse(result, {
        keys: ["champion"],
        threshold: 0.3,
        ignoreLocation: true,
        includeScore: true,
      });
      const fuzzyResults = fuse.search(filterChampion.trim());
      result = fuzzyResults.map((r: FuseResult<MatchMetadata>) => r.item);
    }

    return result;
  }, [matches, filterQueueType, filterLane, filterPlayer, filterChampion, filterOutcome]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredMatches.length / pageSize);
  const paginatedMatches = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    return filteredMatches.slice(startIdx, endIdx);
  }, [filteredMatches, currentPage, pageSize]);

  // Not configured state
  if (!s3Config) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<CloudIcon className="w-16 h-16" />}
          title="Storage Not Configured"
          description="Configure your Cloudflare R2 credentials in Settings to browse match data from your storage."
          action={
            <div className="text-xs text-surface-400">Settings &rarr; API Configuration &rarr; Cloudflare R2</div>
          }
        />
      </div>
    );
  }

  return (
    <div className="p-5">
      {/* Refresh button and filters */}
      <div className="space-y-4 mb-4">
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              void handleBrowse(true);
            }}
            disabled={loading}
            isLoading={loading && !loadingProgress}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </Button>
          <span className="text-xs text-surface-400">Last 7 days</span>
        </div>

        <MatchFilters
          filterQueueType={filterQueueType}
          filterLane={filterLane}
          filterPlayer={filterPlayer}
          filterChampion={filterChampion}
          filterOutcome={filterOutcome}
          onQueueTypeChange={setFilterQueueType}
          onLaneChange={setFilterLane}
          onPlayerChange={setFilterPlayer}
          onChampionChange={setFilterChampion}
          onOutcomeChange={setFilterOutcome}
        />
      </div>

      {/* Loading state */}
      <MatchLoadingState
        loading={loading}
        loadingProgress={loadingProgress}
        onCancel={() => {
          abortController?.abort();
        }}
      />

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-defeat-50 border border-defeat-200 text-sm text-defeat-700 mb-4 animate-fade-in">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-defeat-500 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="font-medium">Error loading matches</p>
              <p className="text-defeat-600 mt-0.5">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Match list */}
      {filteredMatches.length > 0 && !loading && (
        <div className="rounded-xl border border-surface-200 overflow-hidden animate-fade-in">
          {/* Results header */}
          <div className="px-4 py-3 bg-surface-50 border-b border-surface-200 flex justify-between items-center">
            <span className="text-sm text-surface-600">
              <span className="font-medium text-surface-900">
                {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filteredMatches.length)}
              </span>
              {" of "}
              <span className="font-medium text-surface-900">{filteredMatches.length}</span>
              {matches.length !== filteredMatches.length && (
                <span className="text-surface-400"> (filtered from {matches.length.toString()})</span>
              )}
            </span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="select text-xs py-1.5 px-2 w-auto"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          <MatchList
            matches={paginatedMatches}
            selectedMetadata={selectedMetadata}
            filterPlayer={filterPlayer}
            filterChampion={filterChampion}
            filterQueueType={filterQueueType}
            filterLane={filterLane}
            filterOutcome={filterOutcome}
            onSelectMatch={(metadata) => {
              void handleSelectMatch(metadata);
            }}
          />

          <MatchPagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </div>
      )}

      {/* Empty state - no matches */}
      {matches.length === 0 && !loading && !error && (
        <EmptyState
          icon={<SearchIcon className="w-12 h-12" />}
          title="No Matches Found"
          description="No matches found in the last 7 days. Try refreshing or check your R2 configuration."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void handleBrowse(true);
              }}
            >
              Refresh Matches
            </Button>
          }
        />
      )}

      {/* Empty state - filters have no results */}
      {matches.length > 0 && filteredMatches.length === 0 && !loading && (
        <EmptyState
          icon={<SearchIcon className="w-12 h-12" />}
          title="No Matches Match Filters"
          description="Try adjusting your filter criteria to see more results."
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterQueueType("all");
                setFilterLane("all");
                setFilterPlayer("");
                setFilterChampion("");
                setFilterOutcome("all");
              }}
            >
              Clear Filters
            </Button>
          }
        />
      )}
    </div>
  );
}
