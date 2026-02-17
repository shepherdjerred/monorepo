/**
 * S3 match browser for selecting real match data
 */
import Fuse from "fuse.js";
import type { ApiSettings } from "@scout-for-lol/frontend/lib/review-tool/config/schema";
import type {
  CompletedMatch,
  ArenaMatch,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data";
import { MatchFilters } from "./match-filters.tsx";
import { MatchList } from "./match-list.tsx";
import { MatchPagination } from "./match-pagination.tsx";
import { MatchLoadingState } from "./match-loading-state.tsx";
import { Button } from "./ui/button.tsx";
import { EmptyState, CloudIcon, SearchIcon } from "./ui/empty-state.tsx";
import { useMatchBrowser } from "./use-match-browser.ts";

type MatchBrowserProps = {
  onMatchSelected: (
    match: CompletedMatch | ArenaMatch,
    rawMatch: RawMatch,
    rawTimeline: RawTimeline | null,
  ) => void;
  apiSettings: ApiSettings;
};

export function MatchBrowser({
  onMatchSelected,
  apiSettings,
}: MatchBrowserProps) {
  const browser = useMatchBrowser(apiSettings, onMatchSelected, Fuse);

  // Not configured state
  if (!browser.s3Config) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<CloudIcon className="w-16 h-16" />}
          title="Storage Not Configured"
          description="Configure your Cloudflare R2 credentials in Settings to browse match data from your storage."
          action={
            <div className="text-xs text-surface-400">
              Settings &rarr; API Configuration &rarr; Cloudflare R2
            </div>
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
              void browser.handleBrowse(true);
            }}
            disabled={browser.loading}
            isLoading={browser.loading && !browser.loadingProgress}
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
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </Button>
          <span className="text-xs text-surface-400">Last 7 days</span>
        </div>

        <MatchFilters
          filterQueueType={browser.filters.filterQueueType}
          filterLane={browser.filters.filterLane}
          filterPlayer={browser.filters.filterPlayer}
          filterChampion={browser.filters.filterChampion}
          filterOutcome={browser.filters.filterOutcome}
          onQueueTypeChange={browser.setFilterQueueType}
          onLaneChange={browser.setFilterLane}
          onPlayerChange={browser.setFilterPlayer}
          onChampionChange={browser.setFilterChampion}
          onOutcomeChange={browser.setFilterOutcome}
        />
      </div>

      {/* Loading state */}
      <MatchLoadingState
        loading={browser.loading}
        loadingProgress={browser.loadingProgress}
        onCancel={() => {
          browser.abortController?.abort();
        }}
      />

      {/* Error state */}
      {browser.error && (
        <div className="p-4 rounded-xl bg-defeat-50 border border-defeat-200 text-sm text-defeat-700 mb-4 animate-fade-in">
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
            <div>
              <p className="font-medium">Error loading matches</p>
              <p className="text-defeat-600 mt-0.5">{browser.error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Match list */}
      {browser.filteredMatches.length > 0 && !browser.loading && (
        <div className="rounded-xl border border-surface-200 overflow-hidden animate-fade-in">
          {/* Results header */}
          <div className="px-4 py-3 bg-surface-50 border-b border-surface-200 flex justify-between items-center">
            <span className="text-sm text-surface-600">
              <span className="font-medium text-surface-900">
                {(browser.currentPage - 1) * browser.pageSize + 1}-
                {Math.min(
                  browser.currentPage * browser.pageSize,
                  browser.filteredMatches.length,
                )}
              </span>
              {" of "}
              <span className="font-medium text-surface-900">
                {browser.filteredMatches.length}
              </span>
              {browser.matches.length !== browser.filteredMatches.length && (
                <span className="text-surface-400">
                  {" "}
                  (filtered from {browser.matches.length.toString()})
                </span>
              )}
            </span>
            <select
              value={browser.pageSize}
              onChange={(e) => {
                browser.setPageSize(Number(e.target.value));
                browser.setCurrentPage(1);
              }}
              className="select text-xs py-1.5 px-2 w-auto"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          <MatchList
            matches={browser.paginatedMatches}
            selectedMetadata={browser.selectedMetadata}
            filterPlayer={browser.filters.filterPlayer}
            filterChampion={browser.filters.filterChampion}
            filterQueueType={browser.filters.filterQueueType}
            filterLane={browser.filters.filterLane}
            filterOutcome={browser.filters.filterOutcome}
            onSelectMatch={(metadata) => {
              void browser.handleSelectMatch(metadata);
            }}
          />

          <MatchPagination
            currentPage={browser.currentPage}
            totalPages={browser.totalPages}
            onPageChange={browser.setCurrentPage}
          />
        </div>
      )}

      {/* Empty state - no matches */}
      {browser.matches.length === 0 && !browser.loading && !browser.error && (
        <EmptyState
          icon={<SearchIcon className="w-12 h-12" />}
          title="No Matches Found"
          description="No matches found in the last 7 days. Try refreshing or check your R2 configuration."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void browser.handleBrowse(true);
              }}
            >
              Refresh Matches
            </Button>
          }
        />
      )}

      {/* Empty state - filters have no results */}
      {browser.matches.length > 0 &&
        browser.filteredMatches.length === 0 &&
        !browser.loading && (
          <EmptyState
            icon={<SearchIcon className="w-12 h-12" />}
            title="No Matches Match Filters"
            description="Try adjusting your filter criteria to see more results."
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  browser.setFilterQueueType("all");
                  browser.setFilterLane("all");
                  browser.setFilterPlayer("");
                  browser.setFilterChampion("");
                  browser.setFilterOutcome("all");
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
