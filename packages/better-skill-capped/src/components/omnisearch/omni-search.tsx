import type { Bookmarkable } from "#src/model/bookmark";
import type { Watchable } from "#src/model/watch-status";
import React from "react";
import Search from "./search/search.tsx";
import type OmniSearchable from "./omni-searchable.tsx";
import { searchableFields } from "./omni-searchable.tsx";
import { OmniSearchResult } from "./omni-search-result.tsx";
import { TipsButton } from "#src/components/tips-button";
import { TipsModal } from "#src/components/modal/tips-modal";

export type OmniSearchProps = {
  items: OmniSearchable[];
  isWatched: (item: Watchable) => boolean;
  isBookmarked: (item: Bookmarkable) => boolean;
  onToggleBookmark: (item: Bookmarkable) => void;
  onToggleWatchStatus: (item: Watchable) => void;
  isDownloadEnabled: boolean;
  onToggleTipsModal: () => void;
  isTipsModalVisible: boolean;
};

export function OmniSearch({
  items,
  isWatched,
  isBookmarked,
  onToggleBookmark,
  onToggleWatchStatus,
  isDownloadEnabled,
  onToggleTipsModal,
  isTipsModalVisible,
}: OmniSearchProps): React.ReactElement {
  const fuseOptions = {
    keys: searchableFields,
    minMatchCharLength: 2,
    threshold: 0.3,
    useExtendedSearch: true,
    includeMatches: true,
    ignoreLocation: true,
    includeScore: true,
  };

  return (
    <>
      <TipsModal isVisible={isTipsModalVisible} onClose={onToggleTipsModal} />
      <TipsButton onClick={onToggleTipsModal} />
      <Search
        items={items}
        fuseOptions={fuseOptions}
        render={(item) => (
          <OmniSearchResult
            key={item.item.uuid}
            item={item.item}
            isWatched={isWatched}
            isBookmarked={isBookmarked}
            onToggleBookmark={onToggleBookmark}
            onToggleWatchStatus={onToggleWatchStatus}
            matchedStrings={item.matchedStrings}
            isDownloadEnabled={isDownloadEnabled}
          />
        )}
        itemsPerPage={20}
        isBookmarked={isBookmarked}
        isWatched={isWatched}
        searchBarPlaceholder="Search for courses, videos, or game commentary"
      />
    </>
  );
}
