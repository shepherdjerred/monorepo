// The pokeemerald-wasm build exports every C global as a WebAssembly.Global
// whose value is the symbol's address in linear memory. We resolve the handful
// of game-state symbols we need by name instead of hard-coding addresses, so a
// rebuilt wasm keeps working as long as the decomp symbol names are stable.

const GAME_SYMBOL_NAMES = [
  "gSaveBlock1Ptr",
  "gSaveBlock2Ptr",
  "gPlayerParty",
  "gPlayerPartyCount",
  "gBattleResults",
  "gPlayerAvatar",
  "gObjectEvents",
] as const;

type GameSymbolName = (typeof GAME_SYMBOL_NAMES)[number];

export type GameSymbols = Readonly<Record<GameSymbolName, number>>;

function resolveAddress(
  exports: Bun.WebAssembly.Exports,
  name: string,
): number | undefined {
  const value = exports[name];
  if (!(value instanceof WebAssembly.Global)) return undefined;
  // WebAssembly.Global#value is typed `any`; route through `unknown` and
  // narrow rather than asserting.
  const address: unknown = value.value;
  if (typeof address !== "number" || !Number.isInteger(address)) {
    return undefined;
  }
  return address;
}

export function createGameSymbols(
  exports: Bun.WebAssembly.Exports,
): GameSymbols {
  const resolved = new Map<GameSymbolName, number>();
  const missing: string[] = [];
  for (const name of GAME_SYMBOL_NAMES) {
    const address = resolveAddress(exports, name);
    if (address === undefined) {
      missing.push(name);
    } else {
      resolved.set(name, address);
    }
  }
  if (missing.length > 0) {
    throw new TypeError(
      `wasm module is missing required global exports: ${missing.join(", ")}`,
    );
  }
  function addressOf(name: GameSymbolName): number {
    const address = resolved.get(name);
    if (address === undefined) {
      throw new TypeError(`unresolved game symbol: ${name}`);
    }
    return address;
  }
  return {
    gSaveBlock1Ptr: addressOf("gSaveBlock1Ptr"),
    gSaveBlock2Ptr: addressOf("gSaveBlock2Ptr"),
    gPlayerParty: addressOf("gPlayerParty"),
    gPlayerPartyCount: addressOf("gPlayerPartyCount"),
    gBattleResults: addressOf("gBattleResults"),
    gPlayerAvatar: addressOf("gPlayerAvatar"),
    gObjectEvents: addressOf("gObjectEvents"),
  };
}
