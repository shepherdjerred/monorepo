import * as Fuse from "fuse.js";
import React from "react";

// Crisp abstractions are nice, but using Fuse's types is easier :)
export interface FuseSearchProps<T> {
  query?: string;
  items: T[];
  options: Fuse.IFuseOptions<T>;
  render: (items: FuseSearchResult<T>) => React.ReactNode;
  itemsPerPage: number;
  page: number;
  onResultsUpdate: (newResults: T[]) => void;
}

export interface FuseSearchState<T> {
  fuse: Fuse.default<T>;
  matchedItems: FuseSearchResult<T>[];
}

export interface FuseSearchResult<T> {
  item: T;
  matchedStrings: string[];
}

export class FuseSearch<T> extends React.PureComponent<FuseSearchProps<T>, FuseSearchState<T>> {
  constructor(props: Readonly<FuseSearchProps<T>>) {
    super(props);

    const { items, options } = this.props;

    this.state = {
      fuse: createIndexedFuseInstance(items, options),
      matchedItems: [],
    };
  }

  componentDidMount(): void {
    const results = this.getResults();
    this.setState((state) => {
      return {
        ...state,
        matchedItems: results,
      };
    });
    this.props.onResultsUpdate(results.map((result) => result.item));
  }

  componentDidUpdate(prevProps: Readonly<FuseSearchProps<T>>): void {
    // This prevents us from rebuilding fuse if our items haven't changed
    // This happens a lot when a user is typing which results in updates to the "query" prop
    this.rebuildFuseIfNeeded(this.props.items, prevProps.items);
    this.searchIfNeeded(prevProps);
  }

  searchIfNeeded(prevProps: Readonly<FuseSearchProps<T>>): void {
    const needsSearch = prevProps.query !== this.props.query || prevProps.items !== this.props.items;

    if (needsSearch) {
      const results = this.getResults();
      this.setState((state) => {
        return {
          ...state,
          matchedItems: results,
        };
      });
      this.props.onResultsUpdate(results.map((result) => result.item));
    }
  }

  rebuildFuseIfNeeded(currentItems: T[], previousItems: T[]): void {
    if (currentItems === previousItems) {
      return;
    }
    const areItemsTheSameSize = currentItems.length === previousItems.length;
    const areItemsTheSame = currentItems.every((item) => previousItems.includes(item));

    const shouldRebuildFuse = !(areItemsTheSameSize && areItemsTheSame);

    if (shouldRebuildFuse) {
      this.setState({
        fuse: createIndexedFuseInstance(currentItems, this.props.options),
      });
    }
  }

  getResults(): { item: T; matchedStrings: string[] }[] {
    const { fuse } = this.state;
    const { query } = this.props;

    if (query !== undefined && query !== "") {
      const fuseResults = fuse.search(query);

      return fuseResults.map((result) => {
        const { item, matches } = result;
        const matchedStrings = (matches ?? [])
          .map((match) => {
            const { indices, value } = match;
            return indices.map((index) => {
              if (value !== undefined) {
                return value.substring(index[0], index[1] + 1);
              } else {
                return "";
              }
            });
          })
          .flat()
          // Filter out short matches (less than 4 chars) to avoid highlighting scattered letters
          .filter((str) => str.length >= 4)
          // Remove duplicates
          .filter((value, index, self) => self.indexOf(value) === index);

        return {
          item,
          matchedStrings,
        };
      });
    } else {
      return this.props.items.map((item) => {
        return {
          item,
          matchedStrings: [],
        };
      });
    }
  }

  render(): React.ReactNode {
    const { render } = this.props;

    const start = this.props.itemsPerPage * (this.props.page - 1);
    const end = start + this.props.itemsPerPage;

    return this.state.matchedItems.slice(start, end).map((item) => render(item));
  }
}

function createIndexedFuseInstance<T>(items: T[], options: Fuse.IFuseOptions<T>): Fuse.default<T> {
  const index = Fuse.default.createIndex(options.keys ?? [], items);
  return new Fuse.default<T>(items, options, index);
}
