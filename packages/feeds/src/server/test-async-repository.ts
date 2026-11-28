import type { FeedsRepository } from "./types.ts";

/** A synchronous test double's form of {@link FeedsRepository}. */
export type SyncFeedsRepository = {
  [K in keyof FeedsRepository]: (
    ...args: Parameters<FeedsRepository[K]>
  ) => Awaited<ReturnType<FeedsRepository[K]>>;
};

function lift<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => Promise<R> {
  return (...args) =>
    new Promise<R>((resolve) => {
      resolve(fn(...args));
    });
}

/** Presents a synchronous test double through the async repository. */
export function asyncFeedsRepository(
  store: SyncFeedsRepository,
): FeedsRepository {
  return {
    close: lift(() => {
      store.close();
    }),
    reconcileCatalog: lift((feeds) => store.reconcileCatalog(feeds)),
    pruneOldEntries: lift((options) => store.pruneOldEntries(options)),
    listFeedsForPoll: lift((now: number) => store.listFeedsForPoll(now)),
    getFeedById: lift((id: number) => store.getFeedById(id)),
    getFeedByUrl: lift((url: string) => store.getFeedByUrl(url)),
    recordPollNotModified: lift((input) => {
      store.recordPollNotModified(input);
    }),
    recordPollSuccess: lift((input) => store.recordPollSuccess(input)),
    recordPollFailure: lift((input) => {
      store.recordPollFailure(input);
    }),
    summary: lift(() => store.summary()),
    listCategories: lift(() => store.listCategories()),
    listFeedsHealth: lift((redact) => store.listFeedsHealth(redact)),
    queryEntries: lift((query) => store.queryEntries(query)),
    updateEntriesState: lift((body) => store.updateEntriesState(body)),
    markAllRead: lift((body) => store.markAllRead(body)),
    createUserFeed: lift((body) => store.createUserFeed(body)),
    updateUserFeed: lift((id: number, body) => store.updateUserFeed(id, body)),
    deleteUserFeed: lift((id: number) => store.deleteUserFeed(id)),
    createReaderSession: lift((input) => {
      store.createReaderSession(input);
    }),
    validateReaderSession: lift((token: string, now: number) =>
      store.validateReaderSession(token, now),
    ),
    subscriptionsEtag: lift(() => store.subscriptionsEtag()),
    listAllFeeds: lift(() => store.listAllFeeds()),
    listAllCategories: lift(() => store.listAllCategories()),
    queryReaderStreamIds: lift((query) => store.queryReaderStreamIds(query)),
    getEntriesByIds: lift((ids: readonly number[]) =>
      store.getEntriesByIds(ids),
    ),
    editEntryTags: lift((input) => store.editEntryTags(input)),
    renameUserCategory: lift((from: string, to: string) =>
      store.renameUserCategory(from, to),
    ),
    deleteUserCategory: lift((label: string) =>
      store.deleteUserCategory(label),
    ),
  };
}
