# `@shepherdjerred/loaded`

A renderability algebra for asynchronous values, plus the React component that
eliminates it.

This does **not** replace TanStack Query. Query models the lifecycle of the
_resource_ — caching, retries, deduplication, stale time, invalidation,
background refetching. `Loaded<T>` models the lifecycle of _consuming_ it, so
components below the boundary never learn how their data arrived.

```text
query / promise / derived value
         ↓  Loaded.fromQuery
     Loaded<T>            ← map / flatMap / all compose here
         ↓  <LoadingBlock>
   ordinary synchronous T
```

## The type

```ts
type Loaded<T> =
  | { status: "loading"; fetching: boolean }
  | { status: "error"; fetching: boolean; errors: LoadedErrors }
  | { status: "degraded"; fetching: boolean; errors: LoadedErrors; data: T }
  | { status: "done"; fetching: boolean; data: T };
```

Three invariants carry the design:

- **`status` answers renderability and nothing else.** `data` exists on exactly
  `degraded | done`, so holding one of those means holding a value.
- **`errors` exists only where it is non-empty** (`error | degraded`). Nothing
  carries an empty list a caller can forget to check.
- **`fetching` is orthogonal** and present on every variant. A value being
  refreshed is still renderable, so refresh is not a status.

That yields six meaningful states from four variants:

| status     | fetching | meaning                           |
| ---------- | -------- | --------------------------------- |
| `loading`  | `false`  | never asked                       |
| `loading`  | `true`   | first load                        |
| `done`     | `true`   | refreshing, data on screen        |
| `degraded` | `false`  | serving data; last refresh failed |
| `degraded` | `true`   | failed refresh being retried      |
| `error`    | `true`   | retrying after a failure, no data |

## Usage

```tsx
const user = Loaded.fromQuery(useQuery(userQuery));
const org = Loaded.fromQuery(useQuery(orgQuery));

const page = Loaded.map(Loaded.all({ user, org }), toPageModel);

return (
  <LoadingBlock values={{ page }}>
    {(data, meta) => (
      <>
        {meta.errors.length > 0 && <RefreshFailedBanner errors={meta.errors} />}
        <Page model={data.page} />
      </>
    )}
  </LoadingBlock>
);
```

`LoadingBlock` takes a **record**, not a tuple — a positional list lets a
reorder silently swap two same-typed dependencies. It renders `degraded` data
and hands the errors to the child through `meta`, so a failed refresh cannot go
unrendered by omission.

Set the app-wide spinner and error surface once with `LoadingBlockDefaults`.

## Join precedence

`Loaded.all` resolves `error` → `loading` → `degraded` → `done`, with
`fetching` true if any dependency is fetching, and every error re-pathed with
its key (nested joins compose to `["page", "org"]`).

The fatal/non-fatal split is the point: a child with `status: "error"` has no
data and blocks the join; a `degraded` child has data and does not. Collapsing
them would make `all({ user: loading, org: degraded })` render an error page
where it should render a spinner.

A join that resolves to `loading` **drops** its non-fatal errors, because
`loading` carries none. This defers rather than destroys them — the `degraded`
child still holds its own error, so the join surfaces it again as soon as the
pending child resolves.

## Notes

- `Loaded.map`'s callback is allowed to throw. A render-model function that
  blows up is a bug, not an error state.
- `Loaded.fromQuery` branches on **data presence**, not on the producer's own
  status field. Its structural `QueryLike` shape is why this package depends on
  no query library. `QueryLike.data` is `unknown` rather than a generic
  `T | undefined` deliberately: `UseQueryResult` is a discriminated union, and
  inferring from `data: T | undefined` matches per member, so the pending
  member's `data: undefined` wins and collapses every consumer's data type.
  Inferring the whole result and projecting with `QueryData<Q>` is immune,
  because an indexed access distributes over the union.
  Known limitation: a query whose success value is legitimately `undefined`
  projects to `loading`. Wrap such a value before handing it here.
- `Loaded.fromQuery`'s optional `path` is for a value that will _not_ travel
  through a keyed join. `Loaded.all` prefixes its own key, so passing
  `["user"]` and then joining under `user` yields `["user", "user"]`.
- The package contains two type assertions, both in `src/index.ts`: one in
  `Loaded.all`, where the checker cannot connect the loop's proof to the mapped
  result type, and one in `Loaded.fromQuery`, where it cannot reduce `Exclude`
  over an unresolved generic after the `data !== undefined` guard.

## When not to use this

Learned from migrating eight packages onto it, not from theory.

- **Authorization and freshness checks.** `degraded` means "keep rendering the
  last known answer when the refresh fails". That is right for a match list and
  wrong for a permission check. Scout's consumer profile deliberately blocks on
  `isFetching` as well as `isPending` because its access decision must be freshly
  fetched (`staleTime: 0`, `refetchOnMount: "always"`); projecting it onto
  `Loaded` would have turned a stale-guard into a stale-renderer. `Loaded` is a
  renderability model, not a permission model.
- **Sites that already render without their data.** A component reading
  `query.data?.x ?? fallback` and never gating has nothing to gain: it has no
  branch to collapse and no fatal path to soften. Wrapping one in
  `<LoadingBlock>` _adds_ a spinner that did not exist. Use `Loaded.all` for a
  shared error gate and `getOrElse` for display, or leave it alone.
- **Anything that is not a rendering decision.** Analytics effects that fire on
  `isSuccess`/`isError` are asking when to emit an event, not what to draw.
  Rewriting one bought a memoisation problem and two lint suppressions in
  exchange for nothing.

The rule that fell out: **`LoadingBlock` where the site already blocks;
`Loaded.all` + `getOrElse` where it already renders progressively.** Across
Scout's 82 read sites the split was roughly three progressive to two blocking,
so applying the render-prop form uniformly would have been wrong more often
than right.
