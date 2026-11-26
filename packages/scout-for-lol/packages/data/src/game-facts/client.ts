import versionData from "#src/data-dragon/assets/version.json" with { type: "json" };
import {
  GameFactSchema,
  gameFactPath,
  type GameFact,
  type GameFactKind,
} from "#src/game-facts/schema.ts";

/** Game asset root the emitted fact files are served under. */
export const GAME_FACT_ROOT = `/assets/scout/game/${versionData.version}`;

/** The fact file could not be fetched; `status` is the HTTP status. */
export class GameFactLoadError extends Error {
  readonly status: number;
  constructor(kind: GameFactKind, key: string, status: number) {
    super(`Game fact ${kind}/${key} failed to load (HTTP ${String(status)})`);
    this.name = "GameFactLoadError";
    this.status = status;
  }
}

export type GameFactFetcher = (
  url: string,
  init: { signal: AbortSignal | null },
) => Promise<Response>;

export type LoadGameFactOptions = {
  signal?: AbortSignal | undefined;
  /** Override the asset root; defaults to the pinned patch's root. */
  root?: string | undefined;
  /** Override `fetch`; defaults to the global one. */
  fetcher?: GameFactFetcher | undefined;
};

/**
 * Fetch one entity's game facts for a tooltip. A missing file or a network
 * failure is an expected boundary error; a file that parses to a different
 * entity than asked for is a broken contract and throws.
 */
export async function loadGameFact(
  kind: GameFactKind,
  key: string,
  options: LoadGameFactOptions = {},
): Promise<GameFact> {
  const root = options.root ?? GAME_FACT_ROOT;
  const fetcher = options.fetcher ?? fetch;
  const url = `${root}/${gameFactPath(kind, encodeURIComponent(key))}`;
  const response = await fetcher(url, { signal: options.signal ?? null });
  if (!response.ok) throw new GameFactLoadError(kind, key, response.status);
  const fact = GameFactSchema.parse(await response.json());
  if (fact.kind !== kind || fact.key !== key) {
    throw new Error(
      `${url} holds ${fact.kind}/${fact.key}, expected ${kind}/${key}`,
    );
  }
  return fact;
}
