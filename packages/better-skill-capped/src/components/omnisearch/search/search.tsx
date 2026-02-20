import React from "react";
import { Searchbar } from "./searchbar.tsx";
import PaginatedFuseSearch from "./paginated-fuse-search.tsx";
import type { IFuseOptions } from "fuse.js";
import type { FuseSearchResult } from "./fuse-search.tsx";
import { Container } from "#src/components/container";
import FilterSelector from "#src/components/omnisearch/filter/filter-selector";
import type { Filters } from "#src/components/omnisearch/filter/filters";
import { isCommentary } from "#src/model/commentary";
import { isCourse } from "#src/model/course";
import { isVideo } from "#src/model/video";
import type { Watchable } from "#src/model/watch-status";
import type { Bookmarkable } from "#src/model/bookmark";
import Banner, { BannerType } from "#src/components/banner";
import Type, { getType } from "#src/model/type";
import { Role } from "#src/model/role";
import type OmniSearchable from "#src/components/omnisearch/omni-searchable.ts";

export type SearchProps<T extends OmniSearchable> = {
  items: T[];
  fuseOptions: IFuseOptions<T>;
  render: (items: FuseSearchResult<T>) => React.ReactNode;
  itemsPerPage: number;
  searchBarPlaceholder: string;
  isWatched: (item: Watchable) => boolean;
  isBookmarked: (item: Bookmarkable) => boolean;
};

type SearchState = {
  query: string;
  filters: Filters;
};

export default class Search<
  T extends OmniSearchable,
> extends React.PureComponent<SearchProps<T>, SearchState> {
  constructor(props: SearchProps<T>) {
    super(props);

    const defaultFilters: Filters = {
      roles: [
        Role.ALL,
        Role.ADC,
        Role.TOP,
        Role.SUPPORT,
        Role.JUNGLE,
        Role.MID,
      ],
      types: [Type.COURSE, Type.VIDEO, Type.COMMENTARY],
      onlyBookmarked: false,
      onlyUnwatched: true,
      onlyWatched: false,
      onlyUnbookmarked: false,
    };

    this.state = {
      query: "",
      filters: defaultFilters,
    };
  }

  onQueryUpdate(newValue: string): void {
    this.setState((state) => {
      return {
        ...state,
        query: newValue,
      };
    });
  }

  onFiltersUpdate(newValue: Filters): void {
    this.setState((state) => {
      return {
        ...state,
        filters: newValue,
      };
    });
  }

  render(): React.ReactElement {
    const {
      items,
      fuseOptions,
      render,
      itemsPerPage,
      searchBarPlaceholder,
      isBookmarked,
      isWatched,
    } = this.props;
    const { query, filters } = this.state;

    const filteredItems = items
      .filter((item) => {
        if (!(isVideo(item) || isCourse(item) || isCommentary(item))) {
          return false;
        }
        return filters.roles.includes(item.role);
      })
      .filter((item) => {
        if (filters.onlyBookmarked) {
          return isVideo(item) || isCourse(item) || isCommentary(item)
            ? isBookmarked(item)
            : false;
        } else {
          return true;
        }
      })
      .filter((item) => {
        if (filters.onlyUnbookmarked) {
          return isVideo(item) || isCourse(item) || isCommentary(item)
            ? !isBookmarked(item)
            : false;
        } else {
          return true;
        }
      })
      .filter((item) => {
        if (filters.onlyUnwatched) {
          return isVideo(item) || isCourse(item) || isCommentary(item)
            ? !isWatched(item)
            : false;
        } else {
          return true;
        }
      })
      .filter((item) => {
        if (filters.onlyWatched) {
          return isVideo(item) || isCourse(item) || isCommentary(item)
            ? isWatched(item)
            : false;
        } else {
          return true;
        }
      })
      .filter((item) => {
        if (isVideo(item) || isCourse(item) || isCommentary(item)) {
          const type = getType(item);
          return type !== undefined && filters.types.includes(type);
        } else {
          return false;
        }
      });

    return (
      <>
        <Searchbar
          onValueUpdate={this.onQueryUpdate.bind(this)}
          placeholder={searchBarPlaceholder}
        />
        <Container
          sidebar={
            <FilterSelector
              filters={filters}
              onFiltersUpdate={this.onFiltersUpdate.bind(this)}
            />
          }
        >
          <Banner type={BannerType.Warning}>
            Check out <a href="https://scout-for-lol.com/">Scout</a> - a Discord
            bot that notifies you when friends finish League matches with
            detailed post-match reports!
          </Banner>
          <PaginatedFuseSearch
            query={query}
            items={filteredItems}
            fuseOptions={fuseOptions}
            render={render}
            itemsPerPage={itemsPerPage}
          />
        </Container>
      </>
    );
  }
}
