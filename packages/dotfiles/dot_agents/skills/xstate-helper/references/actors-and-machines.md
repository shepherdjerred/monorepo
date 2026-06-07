# XState v5 — Actors & Machines (deep reference)

Full surface for `xstate` 5.32. All examples are v5 (use `setup()`/`createMachine()`/`createActor()`,
never v4 `Machine()`/`interpret()`). In this monorepo, type machines with the **holder-variable**
pattern from `SKILL.md` (not inline `{} as T`).

## Actor lifecycle

```ts
import { createActor, waitFor, toPromise } from "xstate";

const actor = createActor(logic, { input, snapshot /* restored state */ });
actor.subscribe({
  next: (snapshot) => console.log(snapshot.value),
  error: (err) => console.error(err),
  complete: () => console.log("done", actor.getSnapshot().output),
});
actor.start();
actor.send({ type: "EVENT" });          // events are objects, never strings
actor.getSnapshot();                     // current snapshot { value, context, status, output, ... }
actor.getPersistedSnapshot();            // serializable state for persistence (deep)
actor.stop();

// await a condition or completion
const snap = await waitFor(actor, (s) => s.context.count >= 100, { timeout: 10_000 });
const output = await toPromise(actor);   // resolves with output when status === 'done'
```

`snapshot.status` is `'active' | 'done' | 'error' | 'stopped'`. Check `snapshot.status === 'done'`
(v4 used `snapshot.done`). `snapshot.value` is a string (atomic), object (nested `{ form: 'invalid' }`),
or multi-key object (parallel). `snapshot.can({ type })` returns whether an event would transition.
`snapshot.hasTag('tag')` checks active-node tags. `snapshot.matches('state')` tests the value.

## Actor logic creators

```ts
import {
  fromPromise, fromCallback, fromObservable, fromEventObservable, fromTransition,
} from "xstate";

// Promise — resolves to output; can't receive events. Annotate the param (repo rule).
const fetchUser = fromPromise(({ input, signal }: { input: { id: string }; signal: AbortSignal }) =>
  fetch(`/users/${input.id}`, { signal }).then((r) => r.json()),
);

// Transition — a reducer as actor logic; receives/returns state
const counter = fromTransition(
  (state, event: { type: "inc" } | { type: "dec" }) =>
    event.type === "inc" ? { count: state.count + 1 } : { count: state.count - 1 },
  { count: 0 },
);

// Callback — event-driven side effects; CANNOT be async. Use sendBack/receive; return cleanup.
const ticker = fromCallback(({ sendBack, receive, input }) => {
  const id = setInterval(() => sendBack({ type: "TICK" }), 1000);
  receive((event) => { /* events from parent */ });
  return () => clearInterval(id);
});

// Observable — emits snapshots from an RxJS-like stream
const clock = fromObservable(() => interval(1000));
```

Capability matrix: machine actors do everything. Promise/observable **can't receive** events.
Callback/transition **can receive** but don't produce `output`. `fromCallback` doesn't support `onDone`.

## Invoke — state-bound actors (finite/known count)

Started on state entry, stopped on exit. Errors go to `onError` (unlike actions, which can't be caught).

```ts
states: {
  loading: {
    invoke: {
      id: "getUser",
      src: "fetchUser",                                   // string ref into setup({ actors })
      input: ({ context }) => ({ id: context.userId }),   // static value or resolver
      onDone: { target: "success", actions: assign({ user: ({ event }) => event.output }) },
      onError: { target: "failure", actions: assign({ error: ({ event }) => event.error }) },
      onSnapshot: { actions: ({ event }) => console.log(event.snapshot) },
    },
  },
}
```

The done/error events are internally `xstate.done.actor.<id>` / `xstate.error.actor.<id>`. `invoke` may
be an array for multiple actors. Set `reenter: true` on a self-transition to restart invoked actors.

## Spawn — action-based actors (dynamic/unknown count)

Two ways: `spawnChild(...)` action creator (no ref returned, preferred) or `spawn(...)` from the assign
arg (stores an `ActorRef` in context). Always clean up context refs with `stopChild` to avoid leaks.

```ts
import { spawnChild, stopChild, assign } from "xstate";

// spawnChild — fire-and-forget child
entry: spawnChild("fetchData", { id: "fetcher", input: { page: 1 } });

// spawn into context — keep a ref to message it later
on: {
  ADD_TODO: {
    actions: assign({
      todos: ({ context, spawn, event }) => [
        ...context.todos,
        spawn("todoActor", { id: event.id, input: { text: event.text } }),
      ],
    }),
  },
  REMOVE_TODO: {
    actions: [stopChild(({ event }) => event.ref), assign({ /* drop ref from context */ })],
  },
}
```

**Guidance:** a list of todos → the `loadTodos` fetch is an **invoked** actor (one, state-bound); each
todo is a **spawned** actor (dynamic count). Since 5.19.1, `spawn` input is **required** when the
referenced actor declares an input type.

## Hierarchical (compound) states

A parent state nests children; exactly one child active; the parent **must** declare `initial`. A child
`type: 'final'` triggers the parent's `onDone`.

```ts
const coffee = createMachine({
  initial: "preparation",
  states: {
    preparation: {
      initial: "weighing",
      states: {
        weighing: { on: { weighed: "grinding" } },
        grinding: { on: { ground: "ready" } },
        ready: { type: "final" },
      },
      onDone: { target: "brewing" }, // fires when child reaches `ready`
    },
    brewing: {},
  },
});
```

## Parallel states

`type: 'parallel'` — all regions active at once; the value is an object keyed by region. `onDone` fires
only when **every** region reaches a final state.

```ts
const player = createMachine({
  type: "parallel",
  states: {
    track: { initial: "paused", states: { paused: { on: { PLAY: "playing" } }, playing: { on: { STOP: "paused" } } } },
    volume: { initial: "normal", states: { normal: { on: { MUTE: "muted" } }, muted: { on: { UNMUTE: "normal" } } } },
  },
});
// snapshot.value === { track: "playing", volume: "muted" }
```

## History states

A pseudostate remembering the last active child. `target` it to re-enter what was active.

```ts
states: {
  payment: {
    initial: "card",
    states: { card: {}, paypal: {}, hist: { type: "history" /* , history: "deep" */ } },
  },
  address: { on: { back: { target: "payment.hist" } } },
}
```

## Delayed (`after`) transitions

```ts
const m = setup({
  delays: { timeout: ({ context }) => context.attempts * 1000 }, // dynamic delay
}).createMachine({
  initial: "attempting",
  states: {
    attempting: {
      after: { timeout: { target: "attempting", actions: assign({ attempts: ({ context }) => context.attempts + 1 }) } },
    },
  },
});
// inline ms also works: after: { 1000: { target: "next" } }
```

## Eventless (`always`) transitions

Taken immediately whenever enabled (gate with `guard`), right after a normal transition. **Watch for
infinite loops** — set `maxIterations` (5.31) to detect them. States only passed *through* via `always`
are **transient** and not observable in `subscribe`/`waitFor`/`matches`; use `after: { 0: 'next' }` if
you need to observe the intermediate state.

```ts
states: {
  heating: { always: { guard: ({ context }) => context.temp > 100, target: "boiling" } },
  boiling: { entry: "turnOffElement" },
}
```

## Self/communication: `raise`, `sendTo`, `sendParent`, `emit`

```ts
import { raise, sendTo, emit, enqueueActions } from "xstate";

raise({ type: "RETRY" }, { delay: 500 });           // to self
sendTo("childId", { type: "PING" });                 // to another actor
emit({ type: "notification", message: "saved" });    // to external subscribers via actor.on(...)
// Prefer passing a parent ref via input over sendParent for testability.
```

Subscribe to emitted events from outside:

```ts
const actor = createActor(machine).start();
actor.on("notification", (e) => console.log(e.message));
```

## Type-bound setup helpers (5.22+)

When you need typed `enqueueActions`/`emit`/`spawnChild` without inline generics, derive them from the
setup so they're bound to its context/events/emitted types:

```ts
const s = setup({ types: machineTypes }); // machineTypes = annotated holder (repo pattern)
const increment = s.assign({ count: ({ context }) => context.count + 1 });
const ping = s.emit({ type: "PING" });
const batch = s.enqueueActions(({ enqueue, check }) => {
  if (check(() => true)) enqueue(increment);
});
export const machine = s.createMachine({ /* reference increment/ping/batch */ });
```

## Pure transition functions (5.19+) — no actor needed

```ts
import { initialTransition, transition, getMicrosteps, getInitialMicrosteps } from "xstate";

const [initSnap, initActions] = initialTransition(machine);
const [nextSnap, actions] = transition(machine, initSnap, { type: "START" });

// inspect every microstep (incl. always/eventless) without executing actions
const micro = getMicrosteps(machine, initSnap, { type: "NEXT" }); // [[snapshot, actions], ...]
```

## Routable states (5.28+)

```ts
const app = setup({}).createMachine({
  id: "app", initial: "home",
  states: {
    home: { id: "home", route: {} },
    settings: { id: "settings", route: { guard: ({ context }) => context.role === "admin" } },
  },
});
createActor(app).start().send({ type: "xstate.route", to: "#settings" }); // jump from anywhere
```
