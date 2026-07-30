export type EngineBattleEligibilityExports = Readonly<{
  canRunFromBattle: (battler: number) => number;
  canUseItemOnBattler: (itemId: number, battler: number) => number;
  canUseItemOnPartyMon: (itemId: number, partyIndex: number) => number;
}>;

function bindIntegerExport(
  exports: Bun.WebAssembly.Exports,
  name: string,
): (...parameters: number[]) => number {
  const value = exports[name];
  if (typeof value !== "function") {
    throw new TypeError(
      `wasm module is missing required function export: ${name}`,
    );
  }
  return (...parameters) => {
    const result: unknown = Reflect.apply(value, undefined, parameters);
    if (typeof result !== "number" || !Number.isInteger(result)) {
      throw new TypeError(`wasm export ${name} did not return an integer`);
    }
    return result;
  };
}

export function bindEngineBattleEligibilityExports(
  exports: Bun.WebAssembly.Exports,
): EngineBattleEligibilityExports {
  const canRunFromBattle = bindIntegerExport(exports, "WasmCanRunFromBattle");
  const canUseItemOnBattler = bindIntegerExport(
    exports,
    "WasmCanUseBattleItemOnBattler",
  );
  const canUseItemOnPartyMon = bindIntegerExport(
    exports,
    "WasmCanUseBattleItemOnPartyMon",
  );
  return {
    canRunFromBattle: (battler) => canRunFromBattle(battler),
    canUseItemOnBattler: (itemId, battler) =>
      canUseItemOnBattler(itemId, battler),
    canUseItemOnPartyMon: (itemId, partyIndex) =>
      canUseItemOnPartyMon(itemId, partyIndex),
  };
}

function binaryEligibilityResult(result: number, query: string): boolean {
  if (result !== 0 && result !== 1) {
    throw new RangeError(
      `invalid ${query} eligibility result: ${String(result)}`,
    );
  }
  return result === 1;
}

function requireBattler(battler: number): void {
  if (!Number.isInteger(battler) || battler < 0 || battler > 3) {
    throw new RangeError(
      "battle eligibility query requires a battler from 0 through 3",
    );
  }
}

export function canRunFromEngineBattle(
  exports: EngineBattleEligibilityExports,
  battler: number,
): boolean {
  requireBattler(battler);
  return binaryEligibilityResult(
    exports.canRunFromBattle(battler),
    "battle run",
  );
}

export function canUseEngineBattleItemOnBattler(
  exports: EngineBattleEligibilityExports,
  itemId: number,
  battler: number,
): boolean {
  if (!Number.isInteger(itemId)) {
    throw new RangeError("battle item query requires an integer item ID");
  }
  requireBattler(battler);
  return binaryEligibilityResult(
    exports.canUseItemOnBattler(itemId, battler),
    "battle item",
  );
}

export function canUseEngineBattleItemOnPartyMon(
  exports: EngineBattleEligibilityExports,
  itemId: number,
  partySlot: number,
): boolean {
  if (
    !Number.isInteger(itemId) ||
    !Number.isInteger(partySlot) ||
    partySlot < 1 ||
    partySlot > 6
  ) {
    throw new RangeError(
      "battle item query requires an integer item ID and party slot from 1 through 6",
    );
  }
  return binaryEligibilityResult(
    exports.canUseItemOnPartyMon(itemId, partySlot - 1),
    "battle item",
  );
}
