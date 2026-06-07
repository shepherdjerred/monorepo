# XState v5 — Testing, Persistence & v4→v5 Migration (deep reference)

## Testing actors

Use the **Arrange–Act–Assert** pattern. This monorepo uses `bun:test` (Jest-compatible API).

```ts
import { setup, createActor } from "xstate";
import { test, expect } from "bun:test";

test("toggles between active and inactive", () => {
  const notified: string[] = [];

  // Arrange
  const machine = setup({
    actions: { notify: (_, params: { message: string }) => notified.push(params.message) },
  }).createMachine({
    initial: "inactive",
    states: {
      inactive: { on: { toggle: { target: "active" } } },
      active: {
        entry: { type: "notify", params: { message: "Active!" } },
        on: { toggle: { target: "inactive" } },
      },
    },
  });
  const actor = createActor(machine);

  // Act
  actor.start();
  actor.send({ type: "toggle" });
  actor.send({ type: "toggle" });
  actor.send({ type: "toggle" });

  // Assert
  expect(actor.getSnapshot().value).toBe("active");
  expect(notified).toEqual(["Active!", "Active!"]);
});
```

**Mock actions/actors with `machine.provide`** (and `mock` from `bun:test`):

```ts
import { mock, test, expect } from "bun:test";
import { setup, createActor, fromPromise } from "xstate";

test("mocked promise actor reaches success", async () => {
  const fetchData = mock(() => Promise.resolve({ data: "ok" }));
  const machine = setup({ actors: { fetchData: fromPromise(fetchData) } }).createMachine({
    initial: "idle",
    states: {
      idle: { on: { fetch: "loading" } },
      loading: { invoke: { src: "fetchData", onDone: "success", onError: "error" } },
      success: {},
      error: {},
    },
  });

  const actor = createActor(machine).start();
  actor.send({ type: "fetch" });
  await new Promise((r) => setTimeout(r, 0)); // let the microtask resolve

  expect(actor.getSnapshot().value).toBe("success");
  expect(fetchData).toHaveBeenCalled();
});
```

**Caveat:** states entered *and left* via `always` in the same step are **not observable** — they never
appear in `subscribe`/`waitFor`/`getSnapshot().value`/`.matches()`. To observe them, use the inspection
API (`@xstate.microstep`) or change `always` to `after: { 0: 'next' }`.

## Model-based testing (`xstate/graph`)

Model-based testing utilities now live in **`xstate/graph`** (the standalone `@xstate/test` is
deprecated). `createTestModel(machine)` auto-generates paths covering reachable states/transitions.

```ts
import { createTestModel } from "xstate/graph";

const model = createTestModel(machine);
const paths = model.getSimplePaths({
  // 5.30: only traverse events currently enabled by guards
  filterEvents: (state, event) => state.can(event),
});

for (const path of paths) {
  await path.test({
    // map state values to assertions about your real system-under-test
    states: { active: () => expect(/* UI shows active */ true).toBe(true) },
    events: { toggle: () => {/* drive the real UI */} },
  });
}
```

Other helpers: `getShortestPaths`, `getSimplePaths` from `xstate/graph`. Pure inspection helpers
`getMicrosteps`/`transition`/`initialTransition` (see actors reference) let you assert on transitions
without running an actor.

## Persistence & rehydration

```ts
import { createActor } from "xstate";

const actor = createActor(machine).start();
const persisted = actor.getPersistedSnapshot();              // deep, JSON-serializable
localStorage.setItem("state", JSON.stringify(persisted));

// restore
const restored = JSON.parse(localStorage.getItem("state")!);
const restoredActor = createActor(machine, { snapshot: restored }).start();
```

Persistence is **deep** (invoked/spawned children too). `getPersistedSnapshot()` ≠ `getSnapshot()` (the
former is the serializable internal state). Already-executed actions are NOT re-run on restore — use
event sourcing (replay events via the inspection API) if you need them. State must be JSON-serializable.

Persist only the finite value with `machine.resolveState`:

```ts
const resolved = machine.resolveState({ value: "pending" /* , context */ });
createActor(machine, { snapshot: resolved }).start();
```

## Inspection

```ts
const actor = createActor(machine, {
  inspect: (ev) => {
    // ev.type is '@xstate.actor' | '@xstate.event' | '@xstate.snapshot' | '@xstate.microstep'
    if (ev.type === "@xstate.event") console.log("event →", ev.event, "to", ev.actorRef.id);
  },
});
actor.start();
```

`@xstate.microstep` exposes intermediate (incl. `always`) states with `value`, `event`, and
`transitions[]` (each `eventType` is `''` for eventless). Useful for event sourcing and debugging
transient states.

## v4 → v5 migration cheatsheet

### Creating machines & actors
| v4 | v5 |
|---|---|
| `Machine(config)` | `createMachine(config)` |
| `interpret(machine)` | `createActor(machine)` |
| `interpret(machine).start(state)` | `createActor(machine, { snapshot: state }).start()` |
| `machine.withConfig({...})` | `machine.provide({...})` |
| `machine.withContext({...})` | `input` + `context: ({ input }) => ({...})` |
| `schema: {} as {...}` | `types: {} as {...}` (or `setup({ types })`) |
| `tsTypes` / typegen | not supported — use `setup({ types })` + `assertEvent` |
| `predictableActionArguments: true` | removed (default behavior now) |

### Actors
| v4 | v5 |
|---|---|
| `services` | `actors` |
| `invoke.src: (ctx) => async () => {}` | `fromPromise`/`fromCallback`/`fromObservable`/`fromTransition`/`createMachine` |
| `invoke.data` | `invoke.input` |
| final-state `data` | `output` |
| imported `spawn()` in `assign` | `spawnChild(...)` action, or `spawn` from the assigner arg |
| `actor.onTransition(fn)` | `actor.subscribe(fn)` |
| subscribe emits current snapshot immediately | does NOT — read `actor.getSnapshot()` |
| `actor.send("EVENT")` (string) | `actor.send({ type: "EVENT" })` — objects only |
| `state.can("EVENT")` | `state.can({ type: "EVENT" })` |
| `snapshot.done` | `snapshot.status === "done"` |
| `actor.batch([...])` | loop `for (const e of events) actor.send(e)` |

### Actions, guards & transitions
| v4 | v5 |
|---|---|
| `(context, event) => {}` impl signature | single arg `({ context, event }) => {}` |
| `send({...})` action | `raise({...})` (self) / `sendTo("actor", {...})` (others) |
| `pure(() => [...])` | `enqueueActions(({ enqueue }) => {...})` |
| `choose([...])` | `enqueueActions(({ enqueue, check }) => { if (check("g")) {...} })` |
| `cond: "guard"` | `guard: "guard"` |
| extra props on action/guard objects | nest under `params: {...}` |
| `in: "#machine.state"` | `guard: stateIn({...})` |
| `on: { "": {...} }` (eventless) | `always: {...}` |
| `internal: false` | `reenter: true` |
| transitions **external** by default | **internal** by default (use `reenter: true` for old behavior) |
| `escalate("error")` | `throw new Error(...)` (handle via `onError`) |
| `strict: true` | wildcard `"*"` transition that throws |

### States
| v4 | v5 |
|---|---|
| `state.meta` | `state.getMeta()` |
| `state.configuration` | `state._nodes` |
| `state.events` / `state.nextEvents` / `state.history` | removed — use inspection API / track via subscribe |
| `state.toStrings()` | removed (implement a helper) |

### @xstate/react
| v4 | v5/v6 |
|---|---|
| `useInterpret(machine)` | `useActorRef(machine)` |
| `useActor(actorRef)` | `useActor(logic)` takes **logic**; for an existing ref use `useSelector(ref, sel)` + `ref.send(...)` |
| `useMachine(machine, { actions })` | `useMachine(machine.provide({ actions }))` |

### Running v4 and v5 side by side
```bash
bun add xstate5@npm:xstate@5
```
```ts
import { createMachine } from "xstate5";
```
