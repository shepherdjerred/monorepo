import React from "react";
import PaginationControls from "./pagination-controls";
import type { FuseSearchResult } from "./fuse-search";
import { FuseSearch } from "./fuse-search";
import type { IFuseOptions } from "fuse.js";

export type PaginatedFuseSearchProps<T> = {
  query: string;
  items: T[];
  fuseOptions: IFuseOptions<T>;
  render: (items: FuseSearchResult<T>) => React.ReactNode;
  itemsPerPage: number;
}

type PaginatedFuseSearchState<T> = {
  matches: T[];
  currentPage: number;
}

export default class PaginatedFuseSearch<T> extends React.PureComponent<
  PaginatedFuseSearchProps<T>,
  PaginatedFuseSearchState<T>
> {
  constructor(props: PaginatedFuseSearchProps<T>) {
    super(props);

    this.state = {
      matches: [],
      currentPage: 1,
    };
  }

  componentDidUpdate(
    prevProps: Readonly<PaginatedFuseSearchProps<T>>,
    prevState: Readonly<PaginatedFuseSearchState<T>>,
  ): void {
    if (prevProps.query !== this.props.query) {
      this.setState((state) => {
        return {
          ...state,
          currentPage: 1,
        };
      });
    }

    if (prevState.currentPage !== this.state.currentPage) {
      window.scrollTo(0, 0);
    }
  }

  render(): React.ReactNode {
    const { query, items, fuseOptions, render, itemsPerPage } = this.props;
    const { currentPage, matches } = this.state;

    const resultList = (
      <FuseSearch
        query={query}
        items={items}
        options={fuseOptions}
        render={render}
        itemsPerPage={itemsPerPage}
        page={currentPage}
        onResultsUpdate={(newResults: T[]) => {
          this.setState((state) => {
            return {
              ...state,
              matches: newResults,
            };
          });
        }}
      />
    );

    const numberOfPages = Math.ceil(matches.length / itemsPerPage);

    return (
      <>
        {resultList}
        <PaginationControls
          currentPage={currentPage}
          lastPage={numberOfPages}
          onPageChange={(newPage: number) => {
            this.setState((state) => {
              return {
                ...state,
                currentPage: newPage,
              };
            });
          }}
        />
      </>
    );
  }
}
