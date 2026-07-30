import type {
  BattleMenu,
  EngineMapTile,
} from "#src/emulator/engine-observation.ts";
import type { CommandInput } from "#src/game/command/command-input.ts";
import type { Command } from "#src/game/command/command.ts";
import {
  actionOutcome,
  meaningfulStateSignature,
  visualChangeRatio,
  type ActionOutcomeV1,
} from "./game-action-outcome.ts";
import {
  requireBattleItemSelection,
  requireBattleMoveSelection,
  requireSwitchablePartySlot,
} from "./game-battle-control-rules.ts";
import type { GameObservationV2 } from "./game-observation.ts";

export type BattleMoveSelection = Readonly<{
  slot?: number;
  moveId?: number;
  targetBattler?: number;
}>;

type BattleControlPort = Readonly<{
  observe: () => GameObservationV2;
  renderFrame: () => Uint8Array;
  press: (command: CommandInput) => Promise<void>;
  waitFrames: (frames: number) => Promise<void>;
  readMapTile: (x: number, y: number) => EngineMapTile | null;
}>;

type ControlSnapshot = Readonly<{
  observation: GameObservationV2;
  frame: Uint8Array;
}>;

const STEP_FRAMES = 2;
const MAX_FRAMES = 360;
const UNSUPPORTED_BATTLE_TYPE_MASK =
  (1 << 1) |
  (1 << 5) |
  (1 << 6) |
  (1 << 7) |
  (1 << 8) |
  (1 << 9) |
  (1 << 11) |
  (1 << 17) |
  (1 << 18) |
  (1 << 21) |
  (1 << 22) |
  (1 << 24) |
  (1 << 25) |
  (1 << 26) |
  (1 << 27) |
  (1 << 31);

export class GameBattleControl {
  constructor(private readonly port: BattleControlPort) {}

  async move(selection: BattleMoveSelection): Promise<ActionOutcomeV1> {
    const before = this.capture();
    const battle = this.requireDecision(before.observation, ["action", "move"]);
    const matchingMove = requireBattleMoveSelection(battle, selection);

    let timedOut = false;
    if (battle.menu === "action") {
      timedOut ||= await this.selectGridCursor("action", 0);
      timedOut ||= await this.pressAndAwait("a", (observation) => {
        return observation.battle?.menu === "move";
      });
    }
    timedOut ||= await this.selectGridCursor("move", matchingMove.slot - 1);
    timedOut ||= await this.pressAndAwait("a", (observation) => {
      return (
        observation.phase !== "battle" ||
        observation.battle?.menu === "target" ||
        observation.battle?.menu === "action"
      );
    });

    const selectedMoveObservation = this.port.observe();
    if (
      selection.targetBattler !== undefined &&
      selectedMoveObservation.battle?.menu !== "target"
    ) {
      throw new Error(
        "engine did not expose the validated target as a selectable choice",
      );
    }
    if (selectedMoveObservation.battle?.menu === "target") {
      if (selection.targetBattler === undefined) {
        return this.outcome(
          `battle:move:${String(matchingMove.slot)}`,
          before,
          false,
        );
      }
      timedOut ||= await this.selectTarget(selection.targetBattler);
      timedOut ||= await this.pressAndAwait("a", nextActionOrBattleEnd);
    }
    return this.outcome(
      `battle:move:${String(matchingMove.slot)}`,
      before,
      timedOut,
    );
  }

  async run(): Promise<ActionOutcomeV1> {
    const before = this.capture();
    this.requireDecision(before.observation, ["action"]);
    let timedOut = await this.selectGridCursor("action", 3);
    timedOut ||= await this.pressAndAwait("a", nextActionOrBattleEnd);
    return this.outcome("battle:run", before, timedOut);
  }

  async switch(partySlot: number): Promise<ActionOutcomeV1> {
    const before = this.capture();
    this.requireDecision(before.observation, ["action"]);
    requireSwitchablePartySlot(before.observation, partySlot);
    let timedOut = await this.selectGridCursor("action", 2);
    timedOut ||= await this.pressAndAwait("a", partyInputReady);
    timedOut ||= await this.selectPartySlot(partySlot);
    timedOut ||= await this.pressAndAwait("a", partySelectionMenuReady);
    timedOut ||= await this.pressAndAwait("a", nextActionOrBattleEnd);
    return this.outcome(`battle:switch:${String(partySlot)}`, before, timedOut);
  }

  async item(itemId: number, partySlot?: number): Promise<ActionOutcomeV1> {
    const before = this.capture();
    const battle = this.requireDecision(before.observation, ["action"]);
    const { inventoryItem, pocket } = requireBattleItemSelection(
      before.observation,
      battle,
      itemId,
      partySlot,
    );

    let timedOut = await this.selectGridCursor("action", 1);
    timedOut ||= await this.pressAndAwait(
      "a",
      (observation) => observation.battle?.bag?.state === "list",
    );
    timedOut ||= await this.selectBagPocket(pocket);
    timedOut ||= await this.selectBagItem(itemId, inventoryItem.pocket);
    timedOut ||= await this.pressAndAwait("a", itemSelectionAdvanced);
    if (this.port.observe().battle?.bag?.state === "use-confirm") {
      timedOut ||= await this.pressAndAwait("a", itemUseAdvanced);
    }
    if (
      partySlot !== undefined &&
      this.port.observe().battle?.party?.inputReady === true
    ) {
      timedOut ||= await this.selectPartySlot(partySlot);
      timedOut ||= await this.pressAndAwait("a", nextActionOrBattleEnd);
    }
    return this.outcome(`battle:item:${String(itemId)}`, before, timedOut);
  }

  async target(targetBattler: number): Promise<ActionOutcomeV1> {
    const before = this.capture();
    const battle = this.requireDecision(before.observation, ["target"]);
    if (
      !battle.battlers.some(
        (battler) => battler.battler === targetBattler && battler.active,
      )
    ) {
      throw new Error("requested target battler is not active");
    }
    let timedOut = await this.selectTarget(targetBattler);
    timedOut ||= await this.pressAndAwait("a", nextActionOrBattleEnd);
    return this.outcome(
      `battle:target:${String(targetBattler)}`,
      before,
      timedOut,
    );
  }

  private requireDecision(
    observation: GameObservationV2,
    menus: readonly BattleMenu[],
  ): NonNullable<GameObservationV2["battle"]> {
    const battle = observation.battle;
    if (
      observation.phase !== "battle" ||
      battle === null ||
      !observation.readiness.inputReady ||
      !menus.includes(battle.menu)
    ) {
      throw new Error(
        `battle action requires an input-ready ${menus.join(" or ")} decision`,
      );
    }
    if ((battle.typeFlags & UNSUPPORTED_BATTLE_TYPE_MASK) !== 0) {
      throw new Error(
        `battle type is not supported by semantic actions: ${String(battle.typeFlags)}`,
      );
    }
    return battle;
  }

  private async pressAndAwait(
    command: Command,
    predicate: (observation: GameObservationV2) => boolean,
  ): Promise<boolean> {
    const beforeSignature = meaningfulStateSignature(this.port.observe());
    await this.port.press({ command, quantity: 1 });
    let elapsed = 0;
    let current = this.port.observe();
    while (elapsed < MAX_FRAMES) {
      if (
        predicate(current) &&
        (meaningfulStateSignature(current) !== beforeSignature || elapsed >= 30)
      ) {
        return false;
      }
      await this.port.waitFrames(STEP_FRAMES);
      elapsed += STEP_FRAMES;
      current = this.port.observe();
    }
    return true;
  }

  private async selectGridCursor(
    menu: Extract<BattleMenu, "action" | "move">,
    target: number,
  ): Promise<boolean> {
    if (!Number.isInteger(target) || target < 0 || target > 3) {
      throw new RangeError("battle grid cursor target must be 0 through 3");
    }
    const readCursor = (observation: GameObservationV2): number | null => {
      const battle = observation.battle;
      return battle?.menu === menu
        ? menu === "action"
          ? battle.actionCursor
          : battle.moveCursor
        : null;
    };
    let timedOut = false;
    let current = readCursor(this.port.observe());
    if (current === null) {
      throw new Error(`battle ${menu} menu is not input ready`);
    }
    if ((current & 2) !== (target & 2)) {
      const expectedCursor = current ^ 2;
      timedOut ||= await this.pressAndAwait(
        (target & 2) === 0 ? "up" : "down",
        (observation) => readCursor(observation) === expectedCursor,
      );
      current = readCursor(this.port.observe());
    }
    if (current !== null && (current & 1) !== (target & 1)) {
      timedOut ||= await this.pressAndAwait(
        (target & 1) === 0 ? "left" : "right",
        (observation) => readCursor(observation) === target,
      );
    }
    return timedOut || readCursor(this.port.observe()) !== target;
  }

  private async selectTarget(targetBattler: number): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const battle = this.port.observe().battle;
      if (battle?.menu !== "target") return true;
      if (battle.targetBattler === targetBattler) return false;
      const previousTarget = battle.targetBattler;
      const timedOut = await this.pressAndAwait(
        "right",
        (observation) =>
          observation.battle?.menu === "target" &&
          observation.battle.targetBattler !== previousTarget,
      );
      if (timedOut) return true;
    }
    return this.port.observe().battle?.targetBattler !== targetBattler;
  }

  private async selectPartySlot(partySlot: number): Promise<boolean> {
    const target = partySlot - 1;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const party = this.port.observe().battle?.party;
      if (party?.inputReady !== true) return true;
      if (party.slot === target) return false;
      const previousSlot = party.slot;
      const timedOut = await this.pressAndAwait(
        "down",
        (observation) =>
          observation.battle?.party?.inputReady === true &&
          observation.battle.party.slot !== previousSlot,
      );
      if (timedOut) return true;
    }
    return this.port.observe().battle?.party?.slot !== target;
  }

  private async selectBagPocket(targetPocket: number): Promise<boolean> {
    const bag = this.port.observe().battle?.bag;
    if (bag?.state !== "list") return true;
    const forward = (targetPocket - bag.pocket + 5) % 5;
    const backward = (bag.pocket - targetPocket + 5) % 5;
    const command: Command = forward <= backward ? "right" : "left";
    for (let index = 0; index < Math.min(forward, backward); index += 1) {
      const previousPocket = this.port.observe().battle?.bag?.pocket;
      const timedOut = await this.pressAndAwait(
        command,
        (observation) =>
          observation.battle?.bag?.state === "list" &&
          observation.battle.bag.pocket !== previousPocket,
      );
      if (timedOut) return true;
    }
    return this.port.observe().battle?.bag?.pocket !== targetPocket;
  }

  private async selectBagItem(
    itemId: number,
    pocket: string,
  ): Promise<boolean> {
    const itemCount =
      this.port
        .observe()
        .game?.inventory.filter((item) => item.pocket === pocket).length ?? 0;
    for (let attempt = 0; attempt <= itemCount; attempt += 1) {
      const bag = this.port.observe().battle?.bag;
      if (bag?.state !== "list") return true;
      if (bag.itemId === itemId) return false;
      const previousPosition = bag.position;
      const timedOut = await this.pressAndAwait(
        "down",
        (observation) =>
          observation.battle?.bag?.state === "list" &&
          observation.battle.bag.position !== previousPosition,
      );
      if (timedOut) return true;
    }
    return this.port.observe().battle?.bag?.itemId !== itemId;
  }

  private capture(): ControlSnapshot {
    return {
      observation: this.port.observe(),
      frame: this.port.renderFrame(),
    };
  }

  private outcome(
    action: string,
    before: ControlSnapshot,
    timedOut: boolean,
  ): ActionOutcomeV1 {
    const after = this.port.observe();
    const base = actionOutcome(action, before.observation, after, {
      inputApplied: true,
      settleTimedOut: timedOut,
      visualChangeRatio: visualChangeRatio(
        before.frame,
        this.port.renderFrame(),
      ),
    });
    return timedOut
      ? base
      : { ...base, status: "applied", stopReason: "completed" };
  }
}

function nextActionOrBattleEnd(observation: GameObservationV2): boolean {
  return (
    observation.phase !== "battle" || observation.battle?.menu === "action"
  );
}

function partyInputReady(observation: GameObservationV2): boolean {
  return observation.battle?.party?.inputReady === true;
}

function partySelectionMenuReady(observation: GameObservationV2): boolean {
  return (
    observation.phase !== "battle" ||
    (observation.battle?.menu === "party" &&
      observation.battle.party?.inputReady === false)
  );
}

function itemSelectionAdvanced(observation: GameObservationV2): boolean {
  return (
    observation.phase !== "battle" ||
    observation.battle?.bag?.state === "use-confirm" ||
    observation.battle?.party?.inputReady === true ||
    observation.battle?.menu === "action"
  );
}

function itemUseAdvanced(observation: GameObservationV2): boolean {
  return (
    observation.phase !== "battle" ||
    observation.battle?.party?.inputReady === true ||
    observation.battle?.menu === "action"
  );
}
