import React from "react";
import { Searchbar } from "./searchbar.tsx";
import PaginatedFuseSearch from "./paginated-fuse-search.tsx";
import type { IFuseOptions } from "fuse.js";
import type { FuseSearchResult } from "./fuse-search.tsx";
import { Container } from "#src/components/container";
import FilterSelector from "#src/components/omnisearch/filter/filter-selector";
import type { Filters } from "#src/components/omnisearch/filter/filters";
import type { Watchable } from "#src/model/watch-status";
import type { Bookmarkable } from "#src/model/bookmark";
import Banner, { BannerType } from "#src/components/banner";
import { KINDS } from "#src/model/content";
import { ROLES } from "#src/model/role";
import type { OmniSearchable } from "#src/components/omnisearch/omni-searchable.ts";

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
      roles: [...ROLES],
      types: [...KINDS],
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

  override render(): React.ReactElement {
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
      .filter((item) => filters.roles.includes(item.role))
      .filter((item) => (filters.onlyBookmarked ? isBookmarked(item) : true))
      .filter((item) => (filters.onlyUnbookmarked ? !isBookmarked(item) : true))
      .filter((item) => (filters.onlyUnwatched ? !isWatched(item) : true))
      .filter((item) => (filters.onlyWatched ? isWatched(item) : true))
      .filter((item) => filters.types.includes(item.kind));

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
