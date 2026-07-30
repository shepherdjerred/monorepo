export type EngineBattleEligibilityExports = Readonly<{
  canUseItemOnPartyMon: (itemId: number, partyIndex: number) => number;
}>;

export function bindEngineBattleEligibilityExports(
  exports: Bun.WebAssembly.Exports,
): EngineBattleEligibilityExports {
  const value = exports["WasmCanUseBattleItemOnPartyMon"];
  if (typeof value !== "function") {
    throw new TypeError(
      "wasm module is missing required function export: WasmCanUseBattleItemOnPartyMon",
    );
  }
  return {
    canUseItemOnPartyMon: (itemId, partyIndex) => {
      const result: unknown = Reflect.apply(value, undefined, [
        itemId,
        partyIndex,
      ]);
      if (typeof result !== "number" || !Number.isInteger(result)) {
        throw new TypeError(
          "wasm export WasmCanUseBattleItemOnPartyMon did not return an integer",
        );
      }
      return result;
    },
  };
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
  const result = exports.canUseItemOnPartyMon(itemId, partySlot - 1);
  if (result !== 0 && result !== 1) {
    throw new RangeError(
      `invalid battle item eligibility result: ${String(result)}`,
    );
  }
  return result === 1;
}
