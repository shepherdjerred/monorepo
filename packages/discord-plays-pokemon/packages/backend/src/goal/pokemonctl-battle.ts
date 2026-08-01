import { resolveItemId } from "#src/game/battle/generated/item-names.ts";
import { resolveMoveId } from "#src/game/battle/generated/move-names.ts";

type RequestBody = Record<string, unknown>;

export type PokemonctlBattleContext = Readonly<{
  request: (
    method: "GET" | "POST",
    route: string,
    body?: RequestBody,
  ) => Promise<string>;
  printActionText: (value: string, args: string[]) => void;
  readIntegerFlag: (args: string[], name: string) => number | undefined;
}>;

function positiveIntegerArgument(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return parsed;
}

function nonnegativeIntegerArgument(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new TypeError(`${label} must be a nonnegative integer`);
  }
  return parsed;
}

async function handleMove(
  context: PokemonctlBattleContext,
  args: string[],
): Promise<void> {
  const value = args.at(1);
  if (value === undefined || value.startsWith("--")) {
    throw new Error("battle move requires a slot or exact move name");
  }
  const numeric = Number(value);
  const targetBattler = context.readIntegerFlag(args, "--target-battler");
  const selection =
    Number.isInteger(numeric) && numeric >= 1 && numeric <= 4
      ? { slot: numeric }
      : { moveId: resolveMoveId(value) };
  if ("moveId" in selection && selection.moveId === undefined) {
    throw new Error(`unknown move name: ${value}`);
  }
  context.printActionText(
    await context.request("POST", "/battle/move", {
      ...selection,
      ...(targetBattler === undefined ? {} : { targetBattler }),
    }),
    args,
  );
}

async function handleRun(
  context: PokemonctlBattleContext,
  args: string[],
): Promise<void> {
  const unexpected = args.find(
    (argument, index) => index > 0 && argument !== "--full",
  );
  if (unexpected !== undefined) {
    throw new Error(`battle run does not accept arguments: ${unexpected}`);
  }
  context.printActionText(
    await context.request("POST", "/battle/run", {}),
    args,
  );
}

async function handleItem(
  context: PokemonctlBattleContext,
  args: string[],
): Promise<void> {
  const value = args.at(1);
  if (value === undefined || value.startsWith("--")) {
    throw new Error("battle item requires an item id or exact item name");
  }
  const numeric = Number(value);
  const itemId = Number.isInteger(numeric)
    ? positiveIntegerArgument(value, "item id")
    : resolveItemId(value);
  if (itemId === undefined) {
    throw new Error(`unknown item name: ${value}`);
  }
  const partySlot = context.readIntegerFlag(args, "--party-slot");
  context.printActionText(
    await context.request("POST", "/battle/item", {
      itemId,
      ...(partySlot === undefined ? {} : { partySlot }),
    }),
    args,
  );
}

async function handleSwitch(
  context: PokemonctlBattleContext,
  args: string[],
): Promise<void> {
  const value = args.at(1);
  if (value === undefined || value.startsWith("--")) {
    throw new Error("battle switch requires a party slot");
  }
  const partySlot = positiveIntegerArgument(value, "party slot");
  context.printActionText(
    await context.request("POST", "/battle/switch", { partySlot }),
    args,
  );
}

async function handleTarget(
  context: PokemonctlBattleContext,
  args: string[],
): Promise<void> {
  const kind = args.at(1);
  const rawTarget = args.at(2);
  if (
    rawTarget === undefined ||
    (kind !== "battler" && kind !== "party-slot")
  ) {
    throw new Error("battle target requires battler <n> or party-slot <n>");
  }
  const target =
    kind === "battler"
      ? nonnegativeIntegerArgument(rawTarget, kind)
      : positiveIntegerArgument(rawTarget, kind);
  context.printActionText(
    await context.request(
      "POST",
      "/battle/target",
      kind === "battler" ? { battler: target } : { partySlot: target },
    ),
    args,
  );
}

export async function handlePokemonctlBattle(
  context: PokemonctlBattleContext,
  args: string[],
): Promise<void> {
  const operation = args.at(0);
  if (operation === "move") {
    await handleMove(context, args);
    return;
  }
  if (operation === "run") {
    await handleRun(context, args);
    return;
  }
  if (operation === "item") {
    await handleItem(context, args);
    return;
  }
  if (operation === "switch") {
    await handleSwitch(context, args);
    return;
  }
  if (operation === "target") {
    await handleTarget(context, args);
    return;
  }
  throw new Error("battle requires move, run, item, switch, or target");
}
