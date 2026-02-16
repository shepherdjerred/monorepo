import React from "react";
import { Content } from "../model/Content";
import { Router } from "./Router";
import { Bookmark, Bookmarkable } from "../model/Bookmark";
import { LocalStorageBookmarkDatastore } from "../datastore/LocalStorageBookmarkDatastore";
import { BookmarkDatastore } from "../datastore/BookmarkDatastore";
import { WatchStatusDatastore } from "../datastore/WatchStatusDatastore";
import { Watchable, WatchStatus } from "../model/WatchStatus";
import { LocalStorageWatchStatusDatastore } from "../datastore/LocalStorageWatchStatusDatastore";
import * as Sentry from "@sentry/react";
import { Color, Hero, Size } from "./Hero";
import { ManifestLoader } from "../ManifestLoader";
import { Parser } from "../parser/Parser";

export interface AppState {
  content?: Content;
  bookmarkDatastore?: BookmarkDatastore;
  bookmarks: Bookmark[];
  watchStatusesDatastore?: WatchStatusDatastore;
  watchStatuses: WatchStatus[];
  isDownloadEnabled: boolean;
  isTipsModalVisible: boolean;
}

export default class App extends React.Component<unknown, AppState> {
  constructor(props: unknown) {
    super(props);

    this.state = {
      content: undefined,
      bookmarks: [],
      watchStatuses: [],
      isDownloadEnabled: window.localStorage.getItem("download") === "true" || false,
      isTipsModalVisible: false,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async componentDidMount(): Promise<undefined> {
    const manifestLoader = new ManifestLoader();
    const manifest = await manifestLoader.load();
    const parser = new Parser();
    const content = parser.parse(manifest);

    const bookmarkDatastore: BookmarkDatastore = new LocalStorageBookmarkDatastore(content);
    const watchStatusesDatastore: WatchStatusDatastore = new LocalStorageWatchStatusDatastore();

    this.setState({
      content: {
        ...content,
        courses: content.courses.sort((left, right) => right.releaseDate.getTime() - left.releaseDate.getTime()),
        videos: content.videos.sort((left, right) => right.releaseDate.getTime() - left.releaseDate.getTime()),
        commentaries: content.commentaries.sort(
          (left, right) => right.releaseDate.getTime() - left.releaseDate.getTime(),
        ),
      },
      bookmarkDatastore,
      watchStatusesDatastore,
      bookmarks: bookmarkDatastore.get(),
      watchStatuses: watchStatusesDatastore.get(),
    });
  }

  onToggleWatchStatus(item: Bookmarkable): void {
    const { watchStatusesDatastore, watchStatuses } = this.state;
    const currentWatchStatus = this.getWatchStatus(item, watchStatuses);

    if (watchStatusesDatastore === undefined) {
      console.error("Not ready to toggle yet");
    }

    if (currentWatchStatus !== undefined) {
      watchStatusesDatastore?.remove(currentWatchStatus);
    }

    const newStatus = currentWatchStatus !== undefined ? !currentWatchStatus.isWatched : true;

    watchStatusesDatastore?.add({
      item,
      isWatched: newStatus,
      lastUpdate: new Date(),
    });

    this.setState({
      watchStatuses: watchStatusesDatastore?.get() ?? [],
    });
  }

  getWatchStatus(item: Bookmarkable, watchStatuses: WatchStatus[]): WatchStatus | undefined {
    return watchStatuses.find((watchStatus) => {
      return watchStatus.item.uuid === item.uuid;
    });
  }

  onToggleTipsModal(): void {
    this.setState((prevState) => {
      return {
        isTipsModalVisible: !prevState.isTipsModalVisible,
      };
    });
  }

  onToggleBookmark(item: Bookmarkable): void {
    const { bookmarkDatastore, bookmarks } = this.state;
    const currentBookmark = this.getBookmark(item, bookmarks);

    if (bookmarkDatastore === undefined) {
      console.error("Bookmark datastore not ready yet");
    }

    if (currentBookmark !== undefined) {
      bookmarkDatastore?.remove(currentBookmark);
    } else {
      bookmarkDatastore?.add({
        item,
        date: new Date(),
      });
    }
    this.setState({
      bookmarks: bookmarkDatastore?.get() ?? [],
    });
  }

  getBookmark(item: Bookmarkable, bookmarks: Bookmark[]): Bookmark | undefined {
    return bookmarks.find((bookmark) => {
      return bookmark.item.uuid === item.uuid;
    });
  }

  isWatched(item: Watchable): boolean {
    return (
      this.state.watchStatuses.find((watchStatuses) => {
        return watchStatuses.item.uuid === item.uuid && watchStatuses.isWatched;
      }) !== undefined
    );
  }

  isBookmarked(item: Bookmarkable): boolean {
    return (
      this.state.bookmarks.find((bookmark) => {
        return bookmark.item.uuid === item.uuid;
      }) !== undefined
    );
  }

  render(): React.ReactNode {
    return (
      <React.Fragment>
        <Sentry.ErrorBoundary
          fallback={<Hero title="Something went wrong" color={Color.RED} size={Size.FULL} />}
          showDialog={true}
        >
          <Router
            content={this.state.content}
            bookmarks={this.state.bookmarks}
            onToggleBookmark={(item: Bookmarkable) => {
              this.onToggleBookmark(item);
            }}
            watchStatuses={this.state.watchStatuses}
            onToggleWatchStatus={(item: Watchable) => {
              this.onToggleWatchStatus(item);
            }}
            isBookmarked={this.isBookmarked.bind(this)}
            isWatched={this.isWatched.bind(this)}
            isDownloadEnabled={this.state.isDownloadEnabled}
            isTipsModalVisible={this.state.isTipsModalVisible}
            onToggleTipsModal={this.onToggleTipsModal.bind(this)}
          />
        </Sentry.ErrorBoundary>
      </React.Fragment>
    );
  }
}
