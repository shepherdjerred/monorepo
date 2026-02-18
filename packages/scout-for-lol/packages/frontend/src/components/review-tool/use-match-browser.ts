import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { z } from "zod";
import type Fuse from "fuse.js";
import type { FuseResult } from "fuse.js";
import type { ApiSettings } from "@scout-for-lol/frontend/lib/review-tool/config/schema";
import type {
  CompletedMatch,
  ArenaMatch,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data";
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
import {
  getCachedDataAsync,
  setCachedData,
} from "@scout-for-lol/frontend/lib/review-tool/cache";

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

export type MatchBrowserFilters = {
  filterQueueType: string;
  filterLane: string;
  filterPlayer: string;
  filterChampion: string;
  filterOutcome: string;
};

export type UseMatchBrowserResult = {
  loading: boolean;
  loadingProgress: { current: number; total: number } | null;
  matches: MatchMetadata[];
  error: string | null;
  filters: MatchBrowserFilters;
  setFilterQueueType: (v: string) => void;
  setFilterLane: (v: string) => void;
  setFilterPlayer: (v: string) => void;
  setFilterChampion: (v: string) => void;
  setFilterOutcome: (v: string) => void;
  selectedMetadata: MatchMetadata | null;
  currentPage: number;
  setCurrentPage: (p: number) => void;
  pageSize: number;
  setPageSize: (s: number) => void;
  s3Config: S3Config | null;
  handleBrowse: (forceRefresh?: boolean) => Promise<void>;
  handleSelectMatch: (metadata: MatchMetadata) => Promise<void>;
  filteredMatches: MatchMetadata[];
  paginatedMatches: MatchMetadata[];
  totalPages: number;
  abortController: AbortController | null;
};

export function useMatchBrowser(
  apiSettings: ApiSettings,
  onMatchSelected: (
    match: CompletedMatch | ArenaMatch,
    rawMatch: RawMatch,
    rawTimeline: RawTimeline | null,
  ) => void,
  fuseClass: typeof Fuse,
): UseMatchBrowserResult {
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [matches, setMatches] = useState<MatchMetadata[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filterQueueType, setFilterQueueType] = useState<string>("all");
  const [filterLane, setFilterLane] = useState<string>("all");
  const [filterPlayer, setFilterPlayer] = useState<string>("");
  const [filterChampion, setFilterChampion] = useState<string>("");
  const [filterOutcome, setFilterOutcome] = useState<string>("all");
  const [selectedMetadata, setSelectedMetadata] =
    useState<MatchMetadata | null>(null);
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const s3Config = useMemo<S3Config | null>(() => {
    if (
      apiSettings.s3BucketName !== undefined && apiSettings.s3BucketName.length > 0 &&
      apiSettings.awsAccessKeyId !== undefined && apiSettings.awsAccessKeyId.length > 0 &&
      apiSettings.awsSecretAccessKey !== undefined && apiSettings.awsSecretAccessKey.length > 0
    ) {
      return {
        bucketName: apiSettings.s3BucketName,
        accessKeyId: apiSettings.awsAccessKeyId,
        secretAccessKey: apiSettings.awsSecretAccessKey,
        region: apiSettings.awsRegion,
        ...(apiSettings.s3Endpoint !== undefined && apiSettings.s3Endpoint.length > 0 ? { endpoint: apiSettings.s3Endpoint } : {}),
      };
    }
    return null;
  }, [apiSettings]);

  const hasAttemptedAutoFetch = useRef(false);

  const handleBrowse = useCallback(
    async (forceRefresh = false) => {
      if (!s3Config) {
        setError("S3 credentials not configured");
        return;
      }

      const cacheKey = {
        bucketName: s3Config.bucketName,
        region: s3Config.region,
        endpoint: s3Config.endpoint,
        type: "metadata-array",
      };

      if (!forceRefresh) {
        const cached: unknown = await getCachedDataAsync(
          "match-metadata",
          cacheKey,
        );
        const cachedResult = MatchMetadataArraySchema.safeParse(cached);

        if (cachedResult.success && cachedResult.data.length > 0) {
          console.log(
            `[Cache HIT] Loaded ${cachedResult.data.length.toString()} matches from cache (IndexedDB)`,
          );
          setMatches(cachedResult.data);
          setError(null);
          return;
        } else {
          console.log(`[Cache MISS] Need to fetch matches`, {
            forceRefresh,
            hasCachedData: !!cached !== undefined && cached !== null,
          });
        }
      }

      if (abortController) {
        abortController.abort();
      }

      const newAbortController = new AbortController();
      setAbortController(newAbortController);
      setLoading(true);
      setError(null);
      setMatches([]);
      setLoadingProgress(null);

      try {
        const matchKeys = await listMatchesFromS3(s3Config);
        const matchData: MatchMetadata[] = [];
        const totalMatches = matchKeys.length;
        setLoadingProgress({ current: 0, total: totalMatches });

        const BATCH_SIZE = 10;

        for (let i = 0; i < totalMatches; i += BATCH_SIZE) {
          if (newAbortController.signal.aborted) {
            throw new Error("Loading cancelled");
          }

          const batch = matchKeys.slice(
            i,
            Math.min(i + BATCH_SIZE, totalMatches),
          );

          const batchResults = await Promise.allSettled(
            batch.map(async (matchKey) => {
              const rawMatch = await fetchMatchFromS3(s3Config, matchKey.key);
              if (rawMatch) {
                return extractMatchMetadataFromRawMatch(rawMatch, matchKey.key);
              }
              return null;
            }),
          );

          for (const result of batchResults) {
            if (result.status === "fulfilled" && result.value) {
              matchData.push(...result.value);
            }
          }

          setLoadingProgress({
            current: Math.min(i + BATCH_SIZE, totalMatches),
            total: totalMatches,
          });

          if (i + BATCH_SIZE < totalMatches) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        console.log(
          `[Cache WRITE] Caching ${matchData.length.toString()} matches for 24 hours`,
        );
        await setCachedData(
          "match-metadata",
          cacheKey,
          matchData,
          24 * 60 * 60 * 1000,
        );

        setMatches(matchData);
        setLoadingProgress(null);
      } catch (error_) {
        const errorResult = ErrorSchema.safeParse(error_);
        if (
          errorResult.success &&
          errorResult.data.message === "Loading cancelled"
        ) {
          setError("Loading cancelled");
        } else {
          setError(
            errorResult.success ? errorResult.data.message : String(error_),
          );
        }
      } finally {
        setLoading(false);
        setLoadingProgress(null);
        setAbortController(null);
      }
    },
    [s3Config, abortController],
  );

  useEffect(() => {
    if (s3Config && !hasAttemptedAutoFetch.current) {
      hasAttemptedAutoFetch.current = true;
      void handleBrowse(false);
    }
  }, [s3Config, handleBrowse]);

  const handleSelectMatch = async (metadata: MatchMetadata) => {
    if (!s3Config) {
      return;
    }

    setLoading(true);
    setSelectedMetadata(metadata);
    try {
      const [rawMatch, rawTimeline] = await Promise.all([
        fetchMatchFromS3(s3Config, metadata.key),
        fetchTimelineFromS3(s3Config, metadata.key),
      ]);

      if (rawMatch) {
        const match = convertRawMatchToInternalFormat(
          rawMatch,
          metadata.playerName,
        );
        onMatchSelected(match, rawMatch, rawTimeline);
      }
    } catch (error_) {
      const errorResult = ErrorSchema.safeParse(error_);
      setError(errorResult.success ? errorResult.data.message : String(error_));
      setSelectedMetadata(null);
    } finally {
      setLoading(false);
    }
  };

  const filteredMatches = useMemo(() => {
    let result = matches;

    if (filterQueueType !== "all") {
      result = result.filter((m) => m.queueType === filterQueueType);
    }

    if (filterLane !== "all") {
      result = result.filter((m) => m.lane === filterLane);
    }

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

    if (filterPlayer.trim()) {
      const fuse = new fuseClass(result, {
        keys: ["playerName"],
        threshold: 0.3,
        ignoreLocation: true,
        includeScore: true,
      });
      const fuzzyResults = fuse.search(filterPlayer.trim());
      result = fuzzyResults.map((r: FuseResult<MatchMetadata>) => r.item);
    }

    if (filterChampion.trim()) {
      const fuse = new fuseClass(result, {
        keys: ["champion"],
        threshold: 0.3,
        ignoreLocation: true,
        includeScore: true,
      });
      const fuzzyResults = fuse.search(filterChampion.trim());
      result = fuzzyResults.map((r: FuseResult<MatchMetadata>) => r.item);
    }

    return result;
  }, [
    matches,
    filterQueueType,
    filterLane,
    filterPlayer,
    filterChampion,
    filterOutcome,
    fuseClass,
  ]);

  const totalPages = Math.ceil(filteredMatches.length / pageSize);
  const paginatedMatches = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    return filteredMatches.slice(startIdx, endIdx);
  }, [filteredMatches, currentPage, pageSize]);

  return {
    loading,
    loadingProgress,
    matches,
    error,
    filters: {
      filterQueueType,
      filterLane,
      filterPlayer,
      filterChampion,
      filterOutcome,
    },
    setFilterQueueType,
    setFilterLane,
    setFilterPlayer,
    setFilterChampion,
    setFilterOutcome,
    selectedMetadata,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    s3Config,
    handleBrowse,
    handleSelectMatch,
    filteredMatches,
    paginatedMatches,
    totalPages,
    abortController,
  };
}
