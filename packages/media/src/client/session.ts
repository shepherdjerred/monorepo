import type { QueryClient } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";

export class SessionChangedError extends Error {
  constructor() {
    super("Your session changed. Refresh before continuing.");
    this.name = "SessionChangedError";
  }
}

type SessionSnapshot = {
  generation: number;
  user: MediaUser | null | undefined;
};

function authorizationKey(user: MediaUser | null | undefined) {
  return user == null
    ? user
    : JSON.stringify([
        user.id,
        user.plexAccountId,
        user.role,
        user.restricted,
        user.version,
      ]);
}

/** Browser-local isolation, never a substitute for server authorization. */
export class SessionBoundary {
  #snapshot: SessionSnapshot = { generation: 0, user: undefined };
  #generation = 0;
  #reads = new AbortController();
  readonly #listeners = new Set<() => void>();

  constructor(private readonly client: QueryClient) {}

  readonly getSnapshot = () => this.#snapshot;

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  capture(actorId?: string) {
    const generation = this.#generation;
    const { user } = this.#snapshot;
    const assertCurrent = () => {
      if (
        generation !== this.#generation ||
        (actorId !== undefined && user !== undefined && user?.id !== actorId)
      )
        throw new SessionChangedError();
    };
    assertCurrent();
    return { generation, signal: this.#reads.signal, assertCurrent };
  }

  publish(
    user: MediaUser | null,
    generation: number,
    source: "refresh" | "login" | "logout",
  ) {
    if (generation !== this.#generation) throw new SessionChangedError();
    const changed =
      source === "logout" ||
      authorizationKey(user) !== authorizationKey(this.#snapshot.user);
    if (changed) {
      this.#generation++;
      this.#reads.abort();
      this.#reads = new AbortController();
      // A refresh cannot cancel the query publishing itself. Login/logout
      // instead detach its old query too: its asynchronous cancellation must
      // never write an error into the newly published session query.
      void this.client.cancelQueries(
        {
          predicate: (query) =>
            source !== "refresh" || query.queryKey[0] !== "me",
        },
        // Reversion can resolve cancelled callers with the retired data.
        { revert: false },
      );
      this.client.removeQueries({
        predicate: (query) =>
          source !== "refresh" || query.queryKey[0] !== "me",
      });
      for (const mutation of this.client.getMutationCache().getAll()) {
        // TanStack cannot undo a sent write. Prevent deferred work/callbacks
        // from entering the next session; retain command keys in storage.
        const options = { ...mutation.options };
        delete options.onSuccess;
        delete options.onError;
        delete options.onSettled;
        delete options.onMutate;
        options.mutationFn = () => Promise.reject(new SessionChangedError());
        mutation.setOptions(options);
      }
      this.client.getMutationCache().clear();
    }
    this.#snapshot = { user, generation: this.#generation };
    this.client.setQueryData(["me"], user);
    for (const listener of this.#listeners) listener();
  }
}
