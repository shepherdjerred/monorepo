---
name: xstate-helper
description: |
  XState v5 state machines, statecharts, and the actor model for complex, event-driven application logic.
  When user works with XState, state machines, statecharts, actors, createMachine/setup, createActor,
  @xstate/react, @xstate/store, useMachine/useActor/useSelector, invoke/spawn, guards/actions/assign,
  or needs to model complex async flows, wizards, and event-driven state.
---

# XState Helper Agent

Guidance for **XState v5** — state machines, statecharts, and actors. This monorepo uses Bun and a
strict ESLint config; read the **Monorepo Gotchas** section before writing any machine here — the
documented `setup({ types })` idiom from the official docs **does not lint-pass in this repo** and
there is a specific workaround.

## Versions (verified mid-2026)

| Package | Latest | Notes |
|---|---|---|
| `xstate` | 5.32.0 | Core. In-repo use: `discord-plays-pokemon/.../backend` pins `^5.32.0` |
| `@xstate/react` | 6.1.0 | React hooks. peer: `react 16.8–19`, `xstate ^5.28` |
| `@xstate/store` | 4.1.0 | Lightweight store (Zustand-like). React binding is a **separate** package |
| `@xstate/store-react` | 2.0.0 | React binding for store v4 — `@xstate/store/react` was **removed** in v4 |

```bash
bun add xstate                 # core
bun add @xstate/react          # React bindings
bun add @xstate/store @xstate/store-react   # lightweight store + its React binding
```

Requires **TypeScript 5.0+**. In `tsconfig.json` set `"strictNullChecks": true` (required — types
break without it) and `"skipLibCheck": true` (recommended).

## What's New in XState v5 (2024–2026)

v5 made **actors first-class**, removed v4 magic (typegen, implicit string events, external-by-default
transitions), and added `setup()` for type safety. Recent 5.x minors:

- **`actor.select(selector, eq?)`** (5.29) — derive a framework-agnostic `Readable<T>` off any actor's
  snapshot; `.get()` + `.subscribe()` (only fires when the selected value changes). No hook needed.
- **Routable states** (5.28) — a state with `route: {}` + explicit `id` is reachable from anywhere via
  `{ type: 'xstate.route', to: '#id' }`. Routes accept a `guard` (string ref resolved since 5.31.1).
- **`getMicrosteps()` / `getInitialMicrosteps()`** (5.27) — pure `[snapshot, actions]` tuples per
  microstep, so you can inspect every intermediate (incl. `always`) state without executing actions.
- **`maxIterations`** (5.31) — infinite-loop guard for eventless transitions (default `Infinity`).
- **`filterEvents`** (5.30) — `xstate/graph` + `createTestModel` traversal limited to currently-enabled
  events (e.g. `state.can(event)`).
- **`setup().assign/raise/sendTo/emit/spawnChild/enqueueActions(...)`** (5.22) — type-bound action
  helpers; no inline generics. Current best practice for typed `enqueueActions`/`emit`/`spawnChild`.
- **`setup.extend()`** (5.24) and **`setup().createStateConfig()`** (5.21) — composable, modular setups.
- **`mapState(snapshot, mapper)`** (5.31), **`getNextTransitions(snapshot)`** (5.26), partial descriptors
  in `assertEvent(event, 'FEEDBACK.*')` (5.25).
- **Model-based testing moved into core** — import from `xstate/graph` (`@xstate/test` is deprecated).
- **`@xstate/store` v3/v4** — `store.trigger.someEvent(...)` typed API, `.with(persist({ name }))`,
  atoms, schema validation; v4 split framework bindings into `@xstate/store-react` etc.

## Core Mental Model

> **Everything is an actor.** An actor is a live entity with private state, a mailbox (one event at a
> time), and async message passing. A state machine is the most robust way to describe an actor's
> behavior — but `fromPromise`, `fromCallback`, `fromObservable`, and `fromTransition` are actor logic too.

- **Logic** (the machine/definition) is inert. `createActor(logic)` makes a **running actor**.
- `actor.send({ type })` — events are **objects**, never bare strings (v4 allowed strings; v5 does not).
- `actor.getSnapshot()` reads current state; `actor.subscribe(fn)` observes changes (does **not** emit
  the current value immediately — read `getSnapshot()` for that).

```ts
import { createMachine, createActor } from "xstate";

const toggleMachine = createMachine({
  id: "toggle",
  initial: "inactive",
  states: {
    inactive: { on: { toggle: { target: "active" } } },
    active: { on: { toggle: { target: "inactive" } } },
  },
});

const actor = createActor(toggleMachine);
actor.subscribe((snapshot) => console.log(snapshot.value));
actor.start();            // logs "inactive"
actor.send({ type: "toggle" }); // logs "active"
actor.stop();
```

### Machine vs Store — pick the right tool

- **State machine (`xstate`)** — many discrete states, guarded transitions, hierarchy/parallelism, async
  orchestration. Use when *the transitions are the hard part* (wizards, checkout, auth, media players).
- **Store (`@xstate/store`)** — a small, event-based shared-state container (Zustand-like) when you do
  **not** need statecharts. See `references/xstate-store.md`.
- **Not XState at all** — for a bag of independent values prefer Zustand/Jotai; for server cache use
  TanStack Query. A localized form/wizard reducer can just be `useReducer`. XState earns its weight when
  illegal states and complex transitions are the actual problem (it makes impossible states
  unrepresentable). Don't reach for it to hold three booleans.

## setup() + createMachine — the typed entry point

`setup({ types, actors, guards, actions, delays })` registers named implementations and types, then
`.createMachine(config)` references them by string. This is the v5 idiom (v5 has **no typegen**).

```ts
import { setup, assign, fromPromise } from "xstate";

// ⚠️ In THIS repo, do NOT inline `context: {} as Ctx` — see Monorepo Gotchas below.
const machine = setup({
  types: {
    context: {} as { count: number; user: string | undefined },
    events: {} as { type: "inc"; by: number } | { type: "reset" } | { type: "LOAD" },
    input: {} as { start: number },
  },
  actors: {
    loadUser: fromPromise(async ({ input }: { input: { id: number } }) => {
      const res = await fetch(`/api/users/${input.id}`);
      return res.json();
    }),
  },
  guards: {
    canInc: ({ context }) => context.count < 100,
  },
  actions: {
    increment: assign({ count: ({ context, event }) => {
      // narrow the event to access its payload safely
      return event.type === "inc" ? context.count + event.by : context.count;
    } }),
  },
}).createMachine({
  id: "counter",
  initial: "idle",
  context: ({ input }) => ({ count: input.start, user: undefined }),
  states: {
    idle: {
      on: {
        inc: { guard: "canInc", actions: "increment" },
        reset: { actions: assign({ count: 0 }) },
        LOAD: { target: "loading" },
      },
    },
    loading: {
      invoke: {
        src: "loadUser",
        input: { id: 1 },
        onDone: { target: "idle", actions: assign({ user: ({ event }) => event.output.name }) },
        onError: { target: "idle" },
      },
    },
  },
});

const actor = createActor(machine, { input: { start: 0 } }).start();
actor.send({ type: "inc", by: 5 });
```

Override implementations per instance with `machine.provide({ actions, actors, guards, delays })`
(replaces v4 `withConfig`). See `references/actors-and-machines.md` for the full machine/actor surface
(hierarchical & parallel states, history, `after`, `always`, `raise`, `enqueueActions`, `emit`, spawn).

## Context, Actions & Guards (quick reference)

```ts
import { assign, raise, sendTo, enqueueActions, and, or, not, stateIn, assertEvent } from "xstate";

// assign — object or function form; context is immutable, only assign mutates it
assign({ count: ({ context }) => context.count + 1 });
assign(({ context, event }) => ({ count: context.count + 1 }));

// raise — send an event to SELF (optionally delayed)
raise({ type: "RETRY" }, { delay: 1000 });

// sendTo — send to another actor by id, ref, or resolver
sendTo("childId", { type: "PING" });
sendTo(({ context }) => context.someRef, { type: "PING" });

// enqueueActions — replaces v4 choose/pure; imperative composition of actions
enqueueActions(({ context, enqueue, check }) => {
  enqueue.assign({ count: context.count + 1 });
  if (check({ type: "someGuard" })) enqueue("namedAction");
  enqueue.sendTo("childId", { type: "GO" });
});

// guards — string ref, params, or higher-order combinators
guard: and(["isValid", or(["isAdmin", "isGuest"]), not("isBanned")]);
guard: stateIn({ form: "submitting" }); // replaces v4 `in:`

// assertEvent — narrow event type inside an action/guard (throws if wrong)
entry: ({ event }) => {
  assertEvent(event, "inc");
  console.log(event.by); // typed
};
```

**Dynamic params** make actions/guards reusable and decoupled from a specific machine — prefer them
over reading `event` directly:

```ts
const m = setup({
  actions: { greet: (_, params: { name: string }) => console.log(`Hi ${params.name}`) },
}).createMachine({
  entry: { type: "greet", params: ({ context }) => ({ name: context.user.name }) },
});
```

## TypeScript helpers

```ts
import type { ActorRefFrom, SnapshotFrom, EventFromLogic } from "xstate";

type Ref = ActorRefFrom<typeof machine>;   // strongly-typed actor reference (props, child refs)
type Snap = SnapshotFrom<typeof machine>;  // typed snapshot
type Ev = EventFromLogic<typeof machine>;  // union of all event types
```

Also available: `ContextFrom`, `InputFrom`, `OutputFrom`. Use `assertEvent` instead of casting to
narrow event payloads — the repo bans `as` casts.

## @xstate/react (summary)

```tsx
import { useMachine, useActor, useActorRef, useSelector } from "@xstate/react";

const [snapshot, send] = useMachine(machine);          // [snapshot, send, actorRef]
const [snapshot2, send2] = useActor(machine);          // useMachine is an alias of useActor
const actorRef = useActorRef(machine);                 // static ref, no re-render on change
const count = useSelector(actorRef, (s) => s.context.count); // re-renders only when count changes
```

Provide per-instance implementations via `machine.provide(...)`; share an actor across a tree with
`createActorContext(machine)` → `{ Provider, useSelector, useActorRef }`. As of `@xstate/react` 6.1.0,
`useActor`/`useSelector` **throw** when the actor errors (caught by the nearest error boundary). Full
patterns (composition, `createActorContext`, persisted state, child→parent comms) in
`references/react-integration.md`.

## @xstate/store (summary)

A lightweight, type-safe, event-based store for when you don't need a full statechart.

```ts
import { createStore } from "@xstate/store";

const store = createStore({
  context: { count: 0 },
  on: {
    // v3+ assigners return the WHOLE new context (spread it), or undefined to disallow
    inc: (context, event: { by: number }) => ({ ...context, count: context.count + event.by }),
  },
});

store.trigger.inc({ by: 1 });        // typed sugar for store.send({ type: "inc", by: 1 })
store.getSnapshot().context.count;    // 1
```

```tsx
import { useSelector } from "@xstate/store-react"; // NOT "@xstate/store/react" in v4

function Counter() {
  const count = useSelector(store, (s) => s.context.count);
  return <button onClick={() => store.trigger.inc({ by: 1 })}>{count}</button>;
}
```

See `references/xstate-store.md` for `persist`, atoms, schema validation, Immer, undo/redo, and
`fromStore` interop.

## ⚠️ Monorepo Gotchas (read before writing a machine here)

### 1. `setup({ types })` vs the `no-type-assertions` rule

The official docs write `setup({ types: { context: {} as Ctx, events: {} as Ev } })`. The `as` casts are
banned by this repo's `custom-rules/no-type-assertions` ESLint rule — and you **cannot** just suppress
them with an inline lint-disable directive, because the pre-commit `quality-ratchet` caps the total
number of allowed suppressions repo-wide, so adding one more fails the commit.

**Fix:** hoist the phantom types into a **single explicitly-annotated holder variable**. The annotation
(not the literal values) drives XState's inference, so the full event union is preserved:

```ts
import { setup } from "xstate";

interface PlaybackContext { count: number }
type PlaybackEvent = { type: "PLAY" } | { type: "SKIP"; n: number } | { type: "STOP" };
interface PlaybackInput { start: number }

// ✅ ONE annotated object variable — annotation carries the union; values are throwaway defaults.
const machineTypes: {
  context: PlaybackContext;
  events: PlaybackEvent;
  input: PlaybackInput;
} = {
  context: { count: 0 },
  events: { type: "SKIP", n: 1 }, // one member is fine; the annotation supplies the whole union
  input: { start: 0 },
};

export const playbackMachine = setup({
  types: machineTypes,
  // actors, guards, actions...
}).createMachine({
  context: ({ input }) => ({ count: input.start }),
  // ...
});
```

**Pitfall:** passing phantoms **inline** (`types: { events: phantomEvent }`) or via **separate
per-field** annotated consts does NOT work — XState's `const`-generic inference re-narrows `events` to
the single literal (`{ type: "SKIP" }`), which breaks `actor.send` and collapses state values to
`never`. The single annotated *object* variable is what locks it.

### 2. Promise actors — annotate the param, don't use a `void` generic

```ts
import { fromPromise } from "xstate";

// ✅ annotate the destructured param; void return is inferred cleanly
fromPromise(({ input, signal }: { input: { id: string }; signal: AbortSignal }) =>
  fetch(`/api/x/${input.id}`, { signal }).then((r) => r.json()),
);

// ❌ fromPromise<void, TInput>(...) trips @typescript-eslint/no-invalid-void-type
```

### 3. Repo conventions

- **Bun only** — `bun add xstate`, never npm/yarn/pnpm. Test with `bun:test`.
- **No `as` casts** anywhere except `as const` / `as unknown` — use `assertEvent`, guards, and the
  holder-variable pattern instead of casting.
- Keep examples `strict`-clean; the base ESLint config applies `strictTypeChecked`.

## Best Practices

1. **`setup()` first, then `.createMachine()`** — strongly type context/events/input once; reference
   actors/guards/actions by name. Use the holder-variable workaround in this repo.
2. **Eliminate boolean soup** — model mutually-exclusive modes as finite states, not
   `isLoading`/`isError`/`isSuccess` flags. Illegal combinations become unrepresentable.
3. **Invoke vs spawn** — `invoke` for a finite, state-bound async task (lifecycle tied to the state);
   `spawn` for a dynamic/unknown number of actors (one per list item). See the actors reference.
4. **Read with `useSelector`** — select the slice you need so components re-render only when it changes,
   instead of destructuring a whole `useActor` snapshot.
5. **Dynamic params** in actions/guards — keep them reusable and decoupled from one machine.
6. **Keep actors small & composed** — child refs live in the parent snapshot's `children`; wrap with
   custom hooks to keep components decoupled.
7. **Model-based testing** — `createTestModel(machine)` from `xstate/graph` auto-generates paths
   covering every reachable transition; `filterEvents` limits to currently-enabled events.
8. **Reach for `@xstate/store`** when you want event-based shared state without a full statechart —
   don't over-engineer simple global state into a machine.

## When to Ask for Help

- Whether a flow genuinely needs a statechart vs `@xstate/store` vs Zustand/Jotai/`useReducer`.
- Designing hierarchy/parallelism for an ambiguous domain (many interacting modes).
- Performance at scale (many spawned actors, frequent re-renders) and persistence/rehydration strategy.
- Migrating a v4 machine — see the v4→v5 cheatsheet in `references/testing-and-migration.md`.
