/**
 * `Loaded<T>` — a deliberately lossy projection of asynchronous state onto the
 * one question a renderer actually asks: **can I draw this yet?**
 *
 * This is not a replacement for TanStack Query. Query models the lifecycle of
 * the *resource* — caching, retries, deduplication, stale time, invalidation,
 * background refetching. `Loaded<T>` models the lifecycle of *consuming* it, so
 * that components below the boundary never learn how their data arrived:
 *
 * ```text
 *   query / promise / derived value
 *            ↓  fromQuery, done, failed
 *        Loaded<T>            ← map / flatMap / all compose here
 *            ↓  LoadingBlock
 *      ordinary synchronous T
 * ```
 *
 * ## The three invariants
 *
 * - **`status` answers renderability and nothing else.** `data` exists on
 *   exactly `degraded | done`, so a component holding one of those cannot fail
 *   to have a value.
 * - **`errors` exists only where it is non-empty** (`error | degraded`). No
 *   variant carries an empty array that a caller can forget to check, and
 *   "show the first error" needs no undefined guard.
 * - **`fetching` is orthogonal** and present on every variant. Refresh is not a
 *   status, because a value being refreshed is still renderable. That gives six
 *   meaningful states out of four variants — `loading` + `!fetching` is idle,
 *   `done` + `fetching` is a background refresh, `degraded` + `fetching` is a
 *   failed refresh being retried.
 *
 * ## Why `degraded` is its own variant
 *
 * A background refetch that fails while cached data is still on screen is not
 * an error page and not a clean success. Folding it into `done` with an
 * optional error list makes the degradation invisible to anyone who forgets to
 * read the list; giving it a name makes handling it a decision rather than an
 * omission.
 */

/** One failure, tagged with the join path it travelled to get here. */
export type LoadedError = {
  readonly path: readonly string[];
  readonly error: unknown;
};

/** A failure list that is non-empty by construction. */
export type LoadedErrors = readonly [LoadedError, ...LoadedError[]];

export type Loaded<T> =
  | { readonly status: "loading"; readonly fetching: boolean }
  | {
      readonly status: "error";
      readonly fetching: boolean;
      readonly errors: LoadedErrors;
    }
  | {
      readonly status: "degraded";
      readonly fetching: boolean;
      readonly errors: LoadedErrors;
      readonly data: T;
    }
  | { readonly status: "done"; readonly fetching: boolean; readonly data: T };

/**
 * The orthogonal axes, handed to a renderer alongside the data. `errors` is
 * non-empty exactly when the value was `degraded`.
 */
export type LoadedMeta = {
  readonly fetching: boolean;
  readonly errors: readonly LoadedError[];
};

export type LoadedRecord = Record<string, Loaded<unknown>>;

/** Unwraps a record of `Loaded` values to a record of their data. */
export type LoadedData<T extends LoadedRecord> = {
  readonly [K in keyof T]: T[K] extends Loaded<infer U> ? U : never;
};

/**
 * The structural shape `fromQuery` reads. TanStack Query's `UseQueryResult`
 * satisfies it; so does anything else exposing the same three fields, which is
 * why this package depends on no query library.
 */
export type QueryLike<T> = {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly isFetching: boolean;
};

/**
 * `available` covers `degraded | done` — the two variants that can be
 * rendered. Callers needing the full four-way split switch on `status`, which
 * is public.
 */
export type LoadedMatchers<T, R> = {
  readonly loading: (meta: LoadedMeta) => R;
  readonly error: (errors: LoadedErrors, meta: LoadedMeta) => R;
  readonly available: (data: T, meta: LoadedMeta) => R;
};

/** Accumulated state of a join, before it is resolved to a `Loaded`. */
type JoinState = {
  readonly fetching: boolean;
  readonly fatal: boolean;
  readonly pending: boolean;
  readonly errors: readonly LoadedError[];
  readonly data: Record<string, unknown>;
};

const NO_ERRORS: readonly LoadedError[] = [];

/** Nothing requested yet. */
function idle(): Loaded<never> {
  return { status: "loading", fetching: false };
}

/** First load in flight, no data yet. */
function loading(): Loaded<never> {
  return { status: "loading", fetching: true };
}

function done<T>(data: T): Loaded<T> {
  return { status: "done", fetching: false, data };
}

/** Data on screen with a refresh in flight. */
function refreshing<T>(data: T): Loaded<T> {
  return { status: "done", fetching: true, data };
}

/** Data on screen that something failed to refresh. */
function degraded<T>(data: T, errors: LoadedErrors): Loaded<T> {
  return { status: "degraded", fetching: false, errors, data };
}

function failed(error: unknown, path: readonly string[] = []): Loaded<never> {
  return { status: "error", fetching: false, errors: [{ path, error }] };
}

function metaOf<T>(value: Loaded<T>): LoadedMeta {
  return {
    fetching: value.fetching,
    errors:
      value.status === "error" || value.status === "degraded"
        ? value.errors
        : NO_ERRORS,
  };
}

/**
 * Concatenation that preserves non-emptiness. Indexing a non-empty tuple at 0
 * is checked, so this needs no assertion.
 */
function concatErrors(
  head: LoadedErrors,
  tail: readonly LoadedError[],
): LoadedErrors {
  return [head[0], ...head.slice(1), ...tail];
}

/**
 * Transforms the data, preserving every orthogonal axis. A `fn` that throws is
 * allowed to propagate: a render-model function that blows up is a bug, not an
 * error state, and swallowing it here would disguise one as the other.
 */
function map<T, U>(value: Loaded<T>, fn: (data: T) => U): Loaded<U> {
  switch (value.status) {
    case "loading":
    case "error": {
      return value;
    }
    case "degraded": {
      return {
        status: "degraded",
        fetching: value.fetching,
        errors: value.errors,
        data: fn(value.data),
      };
    }
    case "done": {
      return { status: "done", fetching: value.fetching, data: fn(value.data) };
    }
  }
}

/**
 * Folds `extra` errors and fetching state from an outer value into an inner
 * result, using the same precedence as {@link all}: an inner `loading` result
 * drops the extra errors, because `loading` carries none.
 */
function merge<U>(
  inner: Loaded<U>,
  extra: readonly LoadedError[],
  extraFetching: boolean,
): Loaded<U> {
  const fetching = inner.fetching || extraFetching;
  switch (inner.status) {
    case "loading": {
      return { status: "loading", fetching };
    }
    case "error": {
      return {
        status: "error",
        fetching,
        errors: concatErrors(inner.errors, extra),
      };
    }
    case "degraded": {
      return {
        status: "degraded",
        fetching,
        errors: concatErrors(inner.errors, extra),
        data: inner.data,
      };
    }
    case "done": {
      const [head, ...tail] = extra;
      if (head === undefined) {
        return { status: "done", fetching, data: inner.data };
      }
      return {
        status: "degraded",
        fetching,
        errors: [head, ...tail],
        data: inner.data,
      };
    }
  }
}

function flatMap<T, U>(
  value: Loaded<T>,
  fn: (data: T) => Loaded<U>,
): Loaded<U> {
  if (value.status === "loading" || value.status === "error") {
    return value;
  }
  const outer = value.status === "degraded" ? value.errors : NO_ERRORS;
  return merge(fn(value.data), outer, value.fetching);
}

/**
 * Walks the entries once, collecting every axis. Errors are re-pathed with
 * their key so a join's failures stay attributable — nested joins compose to
 * `["page", "user"]`.
 */
function joinEntries(
  entries: readonly (readonly [string, Loaded<unknown>])[],
): JoinState {
  const errors: LoadedError[] = [];
  const data: Record<string, unknown> = {};
  let fetching = false;
  let fatal = false;
  let pending = false;

  for (const [key, value] of entries) {
    fetching = fetching || value.fetching;
    if (value.status === "error" || value.status === "degraded") {
      for (const entry of value.errors) {
        errors.push({ path: [key, ...entry.path], error: entry.error });
      }
    }
    if (value.status === "error") {
      fatal = true;
    } else if (value.status === "loading") {
      pending = true;
    } else {
      data[key] = value.data;
    }
  }

  return { fetching, fatal, pending, errors, data };
}

/**
 * Resolves a join that produced no data. A `fatal` join always collected at
 * least one error, since only an `error` child sets the flag and that variant's
 * error list is non-empty — the throw states an invariant rather than papering
 * over a broken one.
 *
 * Non-fatal errors are deliberately dropped on the `loading` branch: a child
 * that is `degraded` still holds its own error, so the join surfaces it again
 * the moment the pending child resolves.
 */
function unavailable(joined: JoinState): Loaded<never> {
  if (joined.fatal) {
    const [head, ...tail] = joined.errors;
    if (head === undefined) {
      throw new Error("Loaded: a failed dependency reported no errors");
    }
    return {
      status: "error",
      fetching: joined.fetching,
      errors: [head, ...tail],
    };
  }
  return { status: "loading", fetching: joined.fetching };
}

/** Resolves a join whose every child had data. */
function availableFrom<T>(joined: JoinState, data: T): Loaded<T> {
  const [head, ...tail] = joined.errors;
  if (head === undefined) {
    return { status: "done", fetching: joined.fetching, data };
  }
  return {
    status: "degraded",
    fetching: joined.fetching,
    errors: [head, ...tail],
    data,
  };
}

/**
 * Joins a record of dependencies into a single value, which is what turns this
 * from a loading helper into a rendering barrier:
 *
 * ```ts
 * const page = Loaded.all({ user, organization, permissions });
 * ```
 *
 * Precedence is `error` → `loading` → `degraded` → `done`. The fatal/non-fatal
 * split matters: a child with `status: "error"` has no data and blocks the
 * join, while a `degraded` child has data and does not. Collapsing the two
 * would make `all({ user: loading, org: degraded })` render an error page where
 * it should render a spinner.
 *
 * The record form is deliberate — a positional tuple lets a reorder silently
 * swap two same-typed dependencies.
 */
function all<T extends LoadedRecord>(values: T): Loaded<LoadedData<T>> {
  const joined = joinEntries(Object.entries(values));
  if (joined.fatal || joined.pending) {
    return unavailable(joined);
  }
  // Neither fatal nor pending means every entry was `degraded` or `done`, so
  // the loop wrote exactly one own property per key of `T`, each holding that
  // key's `data`. That is precisely `LoadedData<T>`. The checker cannot connect
  // a loop's proof to a mapped type, and this is the only place in the package
  // that needs telling.
  // eslint-disable-next-line custom-rules/no-type-assertions -- proven above
  const data = joined.data as LoadedData<T>;
  return availableFrom(joined, data);
}

/**
 * The homogeneous join — `Loaded<T>[]` to `Loaded<T[]>` — for a list of
 * per-item queries. Same precedence as {@link all}, and unlike it this needs no
 * assertion, because the element type is already known.
 */
function allArray<T>(values: readonly Loaded<T>[]): Loaded<readonly T[]> {
  const joined = joinEntries(
    values.map((value, index) => [String(index), value] as const),
  );
  if (joined.fatal || joined.pending) {
    return unavailable(joined);
  }
  const data: T[] = [];
  for (const value of values) {
    if (value.status === "degraded" || value.status === "done") {
      data.push(value.data);
    }
  }
  return availableFrom(joined, data);
}

function match<T, R>(value: Loaded<T>, matchers: LoadedMatchers<T, R>): R {
  const meta = metaOf(value);
  switch (value.status) {
    case "loading": {
      return matchers.loading(meta);
    }
    case "error": {
      return matchers.error(value.errors, meta);
    }
    case "degraded":
    case "done": {
      return matchers.available(value.data, meta);
    }
  }
}

function getOrElse<T>(value: Loaded<T>, fallback: T): T {
  return value.status === "degraded" || value.status === "done"
    ? value.data
    : fallback;
}

/**
 * Projects a query result onto renderability.
 *
 * The branch is on **data presence**, not on the producer's own status field.
 * That is what keeps the adapter honest: `data !== undefined` narrows
 * `T | undefined` to `T` for real, where trusting `status === "success"` would
 * mean asserting a contract this package cannot check. It also makes the
 * projection right for the case that motivates `degraded` — a failed
 * background refetch with cached data still present.
 *
 * Known limitation: a query whose success value is legitimately `undefined`
 * (`useQuery<string | undefined>`) projects to `loading`. Wrap such a value —
 * in an object, or in a sentinel — before handing it here.
 *
 * `path` is for a value that will *not* travel through a keyed join. {@link all}
 * prefixes its own key, so `fromQuery(query, ["user"])` joined under `user`
 * produces `["user", "user"]`. Pass it only at a root, or omit it.
 */
function fromQuery<T>(
  query: QueryLike<T>,
  path: readonly string[] = [],
): Loaded<T> {
  const errors: LoadedErrors | undefined =
    query.error === undefined || query.error === null
      ? undefined
      : [{ path, error: query.error }];

  if (query.data !== undefined) {
    return errors === undefined
      ? { status: "done", fetching: query.isFetching, data: query.data }
      : {
          status: "degraded",
          fetching: query.isFetching,
          errors,
          data: query.data,
        };
  }
  if (errors !== undefined) {
    return { status: "error", fetching: query.isFetching, errors };
  }
  return { status: "loading", fetching: query.isFetching };
}

/**
 * The namespace shares its name with the type on purpose, so a call site reads
 * `Loaded.all(...)` while an annotation reads `Loaded<User>`.
 */
export const Loaded = {
  idle,
  loading,
  done,
  refreshing,
  degraded,
  failed,
  map,
  flatMap,
  all,
  allArray,
  match,
  getOrElse,
  fromQuery,
};
