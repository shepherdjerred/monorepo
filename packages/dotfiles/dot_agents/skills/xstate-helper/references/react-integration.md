# @xstate/react v6 (deep reference)

`@xstate/react` 6.1.0 — peer deps `react 16.8–19`, `xstate ^5.28`. Hooks return **tuples**; `useMachine`
is an alias of `useActor`.

## Hooks

```tsx
import { useMachine, useActor, useActorRef, useSelector, shallowEqual } from "@xstate/react";

// [snapshot, send, actorRef] — component re-renders on every snapshot change
const [snapshot, send, actorRef] = useMachine(machine);

// alias of useMachine — both take ACTOR LOGIC (a machine), not an existing actor ref
const [snap2, send2] = useActor(machine);

// static ref — does NOT re-render on state change; pair with useSelector for fine-grained reads
const ref = useActorRef(machine);

// selector — re-renders only when the selected value changes (default compare: Object.is)
const count = useSelector(ref, (s) => s.context.count);
const user = useSelector(ref, (s) => s.context.user, (a, b) => a.id === b.id); // custom compare
const partial = useSelector(ref, (s) => s.context.partial, shallowEqual);       // shallow compare
```

**Providing implementations** — pass `machine.provide(...)` (not an options arg):

```tsx
const [snapshot, send] = useMachine(
  machine.provide({
    actions: { doSomething: ({ context }) => { /* ... */ } },
  }),
);
```

**Rehydrate persisted state** via `options.snapshot`:

```tsx
const [state, send] = useMachine(machine, { snapshot: persistedSnapshot });
```

**Error propagation (6.1.0):** `useActor`/`useSelector` **throw** when the actor reaches an error state,
so wrap consumers in an error boundary:

```tsx
function ActorView() {
  const [snapshot, send] = useActor(machine); // throws on actor error
  return <div>{String(snapshot.value)}</div>;
}
// <ErrorBoundary fallback={<p>Something went wrong</p>}><ActorView /></ErrorBoundary>
```

## createActorContext — share one actor across a tree

Returns exactly `{ Provider, useSelector, useActorRef }`. **There is no `.useActor`** on the context
object in v6.

```tsx
import { createActorContext } from "@xstate/react";
import { someMachine } from "./someMachine";

const SomeMachineContext = createActorContext(someMachine);

function App() {
  return (
    <SomeMachineContext.Provider>
      <Display />
      <Controls />
    </SomeMachineContext.Provider>
  );
}

function Display() {
  const count = SomeMachineContext.useSelector((s) => s.context.count);
  return <p>Count: {count}</p>;
}

function Controls() {
  const ref = SomeMachineContext.useActorRef();
  return <button onClick={() => ref.send({ type: "inc" })}>+</button>;
}
```

Swap in a variant for tests/instances via the Provider's `logic` prop:

```tsx
<SomeMachineContext.Provider
  logic={someMachine.provide({ actions: { someAction: mockImpl } })}
>
  <Subtree />
</SomeMachineContext.Provider>
```

The Provider also accepts `options`/`input` for the created actor.

## Patterns

**Read with selectors, not whole snapshots.** Destructuring `const [snapshot] = useMachine(...)`
re-renders on *every* transition. For a leaf component that only needs one value, use `useActorRef` +
`useSelector` (or the context's `useSelector`) so it re-renders only when that slice changes.

**Composing child machines.** Invoked/spawned children live in `snapshot.children`. Select into a child
ref and read it with `useSelector`:

```tsx
function ChildView() {
  const childRef = SomeMachineContext.useSelector((s) => s.children.someChild);
  const childValue = useSelector(childRef, (s) => s?.context.value);
  return <span>{childValue}</span>;
}
```

**Child → parent communication.** Pass the parent ref into the child via `input` and `sendTo` it (more
testable than `sendParent`), or have the parent `invoke` the child with `onSnapshot`/`onDone` handlers
that update parent context. Avoid prop-drilling many `send` callbacks — pass the whole `send` or expose a
child-scoped `useSelector` hook instead.

**`actor.select(...)` outside React.** For non-component code (or framework-agnostic derived state) use
`actorRef.select((s) => s.context.count)` — returns a `Readable` with `.get()`/`.subscribe()` that only
emits when the selected value changes; no hook required.
