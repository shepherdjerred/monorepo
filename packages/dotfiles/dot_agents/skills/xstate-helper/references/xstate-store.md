# @xstate/store v4 (deep reference)

A lightweight, type-safe, event-based store — Zustand-like ergonomics without full statecharts. Reach
for it when the *transitions* aren't the hard part. `@xstate/store` 4.1.0.

> **v4 import change:** the React binding is the dedicated package **`@xstate/store-react`** (2.0.0).
> The old `@xstate/store/react` subpath was **removed** in v4. (Siblings: `@xstate/store-solid`,
> `@xstate/store-vue`.) Pre-v4 blog posts showing `from '@xstate/store/react'` are out of date.

```bash
bun add @xstate/store @xstate/store-react
```

## createStore

Assigners receive `(context, event, enqueue)` and **return the whole new context** (spread it). Returning
`undefined` disallows the transition (a no-op). The two-arg `createStore(context, transitions)` form was
removed in v3 — use the single config object.

```ts
import { createStore } from "@xstate/store";

export const donutStore = createStore({
  context: { donuts: 0, favoriteFlavor: "chocolate" },
  on: {
    addDonut: (context) => ({ ...context, donuts: context.donuts + 1 }),
    changeFlavor: (context, event: { flavor: string }) => ({ ...context, favoriteFlavor: event.flavor }),
    eatAllDonuts: (context) => ({ ...context, donuts: 0 }),
  },
});
```

## Store instance API

```ts
store.send({ type: "addDonut" });               // base send (event object)
store.trigger.addDonut();                        // typed sugar ≡ send({ type: "addDonut" })
store.trigger.changeFlavor({ flavor: "mint" });  // ≡ send({ type: "changeFlavor", flavor: "mint" })
store.getSnapshot().context.donuts;              // explicit snapshot read
store.get().context.donuts;                       // snapshot as a Readable (tracked/reactive reads)
store.subscribe((snapshot) => console.log(snapshot.context));
store.can.addDonut();                             // boolean — is the event allowed? (no mutation)
store.select((s) => s.context.donuts);            // subscribable derived Selection
store.on("increased", (event) => { /* emitted-event listener */ });
store.transition(state, event);                   // pure [nextState, effects] tuple
store.with(extension);                            // returns a new, extended store
```

## React binding

```tsx
import { useSelector } from "@xstate/store-react"; // re-exports all of @xstate/store too

function DonutCounter() {
  const donuts = useSelector(donutStore, (s) => s.context.donuts);
  return <button onClick={() => donutStore.trigger.addDonut()}>Donuts: {donuts}</button>;
}

// useSelector with no selector returns the full snapshot
const snapshot = useSelector(donutStore);
```

**Component-scoped store** (stable across re-renders) and **custom store hook**:

```tsx
import { useStore, useSelector, createStoreHook } from "@xstate/store-react";

function Counter() {
  const store = useStore({ context: { count: 0 }, on: { inc: (c) => ({ ...c, count: c.count + 1 }) } });
  const count = useSelector(store, (s) => s.context.count);
  return <button onClick={() => store.trigger.inc()}>{count}</button>;
}

// reusable hook: returns [selectedValue, store]
const useCountStore = createStoreHook({
  context: { count: 0 },
  on: { inc: (c, e: { by: number }) => ({ ...c, count: c.count + e.by }) },
});
function Counter2() {
  const [count, store] = useCountStore((s) => s.context.count);
  return <button onClick={() => store.trigger.inc({ by: 1 })}>{count}</button>;
}
```

## Emitting events & side effects

```ts
import { createStore } from "@xstate/store";
import { z } from "zod";

const store = createStore({
  schemas: { emitted: { increased: z.object({ by: z.number() }) } },
  context: { count: 0 },
  on: {
    inc: (context, event: { by: number }, enqueue) => {
      enqueue.emit.increased({ by: event.by });        // emit to store.on(...) listeners
      enqueue.effect(async () => { /* async side effect */ });
      return { ...context, count: context.count + event.by };
    },
    // v4: enqueue store events from a transition
    incTwice: (context, _event, enq) => {
      enq.trigger.inc({ by: 1 });
      enq.trigger.inc({ by: 1 });
      return context;
    },
  },
});
store.on("increased", (e) => console.log(`+${e.by}`));
```

## Immer (createStoreWithProducer removed in v4)

`createStoreWithProducer` no longer exists. Use `produce` inline:

```ts
import { createStore } from "@xstate/store";
import { produce } from "immer";

const store = createStore({
  context: { donuts: 0 },
  on: { addDonut: (context) => produce(context, (draft) => { draft.donuts++; }) },
});
```

## Extensions via `.with(...)`

```ts
import { createStore } from "@xstate/store";
import { persist } from "@xstate/store/persist";
import { undoRedo } from "@xstate/store/undo";
import { validateSchemas } from "@xstate/store/validate";
import { z } from "zod";

// persist — name is the required storage key
const persisted = createStore({ context: { count: 0 }, on: { inc: (c) => ({ count: c.count + 1 }) } })
  .with(persist({ name: "my-store" }));

// undo/redo
const undoable = createStore({ context: { count: 0 }, on: { inc: (c) => ({ count: c.count + 1 }) } })
  .with(undoRedo());
undoable.trigger.inc();
undoable.trigger.undo();

// schema validation — invalid send/trigger throws StoreValidationError; can.* returns false
const validated = createStore({
  schemas: { context: z.object({ count: z.number() }), events: { increment: z.object({ by: z.number() }) } },
  context: { count: 0 },
  on: { increment: (c, e) => ({ count: c.count + e.by }) },
}).with(validateSchemas());
```

`persist` options (from `@xstate/store/persist`): `name` (required), `storage?` (defaults to
`localStorage`), `version?`, `throttle?`, `migrate?`, `merge?`, `filter`/`pick`, `skipHydration?`, plus an
event-replay strategy (`strategy: 'event'`). Helpers: `createJSONStorage(getStorage)` (SSR-safe / async
storage like React Native `AsyncStorage`), `clearStorage`, `flushStorage`, `isHydrated`,
`createBroadcastStorage`.

```ts
import { createJSONStorage } from "@xstate/store/persist";
const storage = createJSONStorage(() => localStorage);     // SSR-safe (noop if unavailable)
const asyncStorage = createJSONStorage(() => AsyncStorage); // React Native
```

## Atoms

Reactive primitives, exported from `@xstate/store`. In v4, computed atoms read peers via `.get()` (the
old `read` callback arg was removed); async atoms receive an `AbortSignal`.

```ts
import { createAtom, createAsyncAtom } from "@xstate/store";

const countAtom = createAtom(0);
const doubled = createAtom(() => countAtom.get() * 2);           // computed (v4: use .get())
const user = createAsyncAtom(async ({ signal }) => {
  const res = await fetch("/user", { signal });
  return res.json();
});
countAtom.set((c) => c + 1);
```

```tsx
import { useAtom } from "@xstate/store-react";
function CountView() {
  const count = useAtom(countAtom);
  return <button onClick={() => countAtom.set((c) => c + 1)}>{count}</button>;
}
```

## XState interop — fromStore / createStoreLogic

Turn a store definition into actor logic usable in machines and framework hooks:

```ts
import { fromStore } from "@xstate/store";
import { createActor } from "xstate";

const storeLogic = fromStore({
  context: (input: { initialCount: number }) => ({ count: input.initialCount }),
  on: { inc: (c) => ({ ...c, count: c.count + 1 }) },
});
const actor = createActor(storeLogic, { input: { initialCount: 42 } }).start();

// reusable definition (v4)
import { createStoreLogic } from "@xstate/store";
const counterLogic = createStoreLogic({
  context: (input: { initialCount: number }) => ({ count: input.initialCount }),
  on: { inc: (c) => ({ ...c, count: c.count + 1 }) },
});
// const store = useStore(counterLogic, { initialCount: 0 });
```
