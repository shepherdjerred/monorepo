/**
 * A module kept out of the first load and fetched when it is about to be
 * needed: on hover or focus of what opens it, and at the latest when it
 * opens. The opener awaits `load()` and then renders `current`, so a
 * popup never shows a loading state for its own code.
 */
export function deferred<T>(fetchModule: () => Promise<T>) {
  let loaded: T | undefined;
  let pending: Promise<T> | undefined;
  async function fetchOnce() {
    try {
      loaded = await fetchModule();
      return loaded;
    } catch (error) {
      // A failed fetch is tried again by the next opener.
      pending = undefined;
      throw error;
    }
  }
  function load(): Promise<T> {
    pending ??= fetchOnce();
    return pending;
  }
  return {
    load,
    /** Start fetching without waiting, as a trigger is approached. */
    prefetch: () => {
      void (async () => {
        try {
          await load();
        } catch {
          // The opener reports a failure when it awaits the same load.
        }
      })();
    },
    get current() {
      return loaded;
    },
  };
}
