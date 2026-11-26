import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  GameFact,
  GameFactKind,
} from "@scout-for-lol/data/game-facts/schema.ts";
import {
  createGameFactStore,
  isAbortError,
  type GameFactLoader,
  type GameFactStore,
} from "#src/domain/tooltips/game-fact-store.ts";

const GameFactContext = createContext<GameFactStore | undefined>(undefined);

/**
 * Supplies the data client the tooltips load facts through, and the in-memory
 * cache in front of it. The app passes `loadGameFact` from
 * `@scout-for-lol/data/game-facts/client.ts`; the design system never fetches
 * on its own.
 */
export function GameFactProvider(props: {
  loader: GameFactLoader;
  children: ReactNode;
}) {
  const { loader } = props;
  const store = useMemo(() => createGameFactStore(loader), [loader]);
  return (
    <GameFactContext.Provider value={store}>
      {props.children}
    </GameFactContext.Provider>
  );
}

function useGameFactStore(): GameFactStore {
  const store = useContext(GameFactContext);
  if (store === undefined) {
    throw new Error("Game fact tooltips need a GameFactProvider above them");
  }
  return store;
}

export type GameFactState =
  | { status: "loading" }
  | { status: "ready"; fact: GameFact }
  | { status: "error" };

/**
 * The fact for one entity. It loads when the component mounts, which for a
 * tooltip is when its layer opens, and the request is aborted if the layer
 * closes first. A fact already in the cache is ready on the first render.
 */
export function useGameFact(kind: GameFactKind, key: string): GameFactState {
  const store = useGameFactStore();
  const [state, setState] = useState<GameFactState>(() => {
    const cached = store.peek(kind, key);
    return cached === undefined
      ? { status: "loading" }
      : { status: "ready", fact: cached };
  });

  useEffect(() => {
    if (store.peek(kind, key) === undefined) setState({ status: "loading" });
    const handle = store.load(kind, key);
    const live = { current: true };
    void (async () => {
      try {
        const fact = await handle.promise;
        if (live.current) setState({ status: "ready", fact });
      } catch (error: unknown) {
        if (live.current && !isAbortError(error)) setState({ status: "error" });
      }
    })();
    return () => {
      live.current = false;
      handle.release();
    };
  }, [store, kind, key]);

  return state;
}

/**
 * Warms the cache while the reader is still deciding. Hand the result to a
 * tooltip's `onIntent`: it starts the request as the pointer settles on the
 * trigger and aborts it if the pointer leaves before the layer opens.
 */
export function useGameFactIntent(
  kind: GameFactKind,
  key: string,
): () => () => void {
  const store = useGameFactStore();
  return useCallback(() => {
    return store.load(kind, key).release;
  }, [store, kind, key]);
}
