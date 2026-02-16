import { Bookmarkable } from "../../model/Bookmark";
import { Watchable } from "../../model/WatchStatus";
import React from "react";
import Search from "./search/Search";
import OmniSearchable, { searchableFields } from "./OmniSearchable";
import { OmniSearchResult } from "./OmniSearchResult";
import { TipsButton } from "../TipsButton";
import { TipsModal } from "../modal/TipsModal";

export interface OmniSearchProps {
  items: OmniSearchable[];
  isWatched: (item: Watchable) => boolean;
  isBookmarked: (item: Bookmarkable) => boolean;
  onToggleBookmark: (item: Bookmarkable) => void;
  onToggleWatchStatus: (item: Watchable) => void;
  isDownloadEnabled: boolean;
  onToggleTipsModal: () => void;
  isTipsModalVisible: boolean;
}

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
