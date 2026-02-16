import React from "react";
import { Searchbar } from "./Searchbar";
import PaginatedFuseSearch from "./PaginatedFuseSearch";
import type { IFuseOptions } from "fuse.js";
import type { FuseSearchResult } from "./FuseSearch";
import { Container } from "@shepherdjerred/better-skill-capped/components/Container";
import FilterSelector from "@shepherdjerred/better-skill-capped/components/omnisearch/filter/FilterSelector";
import type { Filters } from "@shepherdjerred/better-skill-capped/components/omnisearch/filter/Filters";
import { isCommentary } from "@shepherdjerred/better-skill-capped/model/Commentary";
import { isCourse } from "@shepherdjerred/better-skill-capped/model/Course";
import { isVideo } from "@shepherdjerred/better-skill-capped/model/Video";
import type { Watchable } from "@shepherdjerred/better-skill-capped/model/WatchStatus";
import type { Bookmarkable } from "@shepherdjerred/better-skill-capped/model/Bookmark";
import Banner, { BannerType } from "@shepherdjerred/better-skill-capped/components/Banner";
import Type, { getType } from "@shepherdjerred/better-skill-capped/model/Type";
import { Role } from "@shepherdjerred/better-skill-capped/model/Role";

export type SearchProps<T> = {
  items: T[];
  fuseOptions: IFuseOptions<T>;
  render: (items: FuseSearchResult<T>) => React.ReactNode;
  itemsPerPage: number;
  searchBarPlaceholder: string;
  isWatched: (item: Watchable) => boolean;
  isBookmarked: (item: Bookmarkable) => boolean;
}

type SearchState = {
  query: string;
  filters: Filters;
}

export default class Search<T> extends React.PureComponent<SearchProps<T>, SearchState> {
  constructor(props: SearchProps<T>) {
    super(props);

    const defaultFilters: Filters = {
      roles: [Role.ALL, Role.ADC, Role.TOP, Role.SUPPORT, Role.JUNGLE, Role.MID],
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
    const { items, fuseOptions, render, itemsPerPage, searchBarPlaceholder, isBookmarked, isWatched } = this.props;
    const { query, filters } = this.state;

    // TODO this is very hacky. fix it.
    const filteredItems = items
      .filter((item) => {
        return isVideo(item) || isCourse(item) || isCommentary(item) ? filters.roles.find((role) => role === item.role) !== undefined : false;
      })
      .filter((item) => {
        if (filters.onlyBookmarked) {
          return isVideo(item) || isCourse(item) || isCommentary(item) ? isBookmarked(item) : false;
        } else {
          return true;
        }
      })
      .filter((item) => {
        if (filters.onlyUnbookmarked) {
          return isVideo(item) || isCourse(item) || isCommentary(item) ? !isBookmarked(item) : false;
        } else {
          return true;
        }
      })
      .filter((item) => {
        if (filters.onlyUnwatched) {
          return isVideo(item) || isCourse(item) || isCommentary(item) ? !isWatched(item) : false;
        } else {
          return true;
        }
      })
      .filter((item) => {
        if (filters.onlyWatched) {
          return isVideo(item) || isCourse(item) || isCommentary(item) ? isWatched(item) : false;
        } else {
          return true;
        }
      })
      .filter((item) => {
        if (isVideo(item) || isCourse(item) || isCommentary(item)) {
          const type = getType(item);
          return filters.types.find((candidate) => candidate === type) !== undefined;
        } else {
          return false;
        }
      });

    return (
      <>
        <Searchbar onValueUpdate={this.onQueryUpdate.bind(this)} placeholder={searchBarPlaceholder} />
        <Container sidebar={<FilterSelector filters={filters} onFiltersUpdate={this.onFiltersUpdate.bind(this)} />}>
          <Banner type={BannerType.Warning}>
            Check out <a href="https://scout-for-lol.com/">Scout</a> - a Discord bot that notifies you when friends
            finish League matches with detailed post-match reports!
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
