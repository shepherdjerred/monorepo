import { z } from "zod";
import { parseCommandInput } from "#src/game/command/command-input.ts";
import type { WaitCondition } from "./game-controller.ts";
import type { GoalControlContext, Routed } from "./control-context.ts";
import { readGameMap, readGameMapExits } from "./game-map.ts";

const TapRequestSchema = z.strictObject({
  command: z.string().min(1),
  repeat: z.number().int().min(1).max(20).default(1),
});

const DirectionSchema = z.enum(["north", "south", "west", "east"]);

const MoveRequestSchema = z.strictObject({
  direction: DirectionSchema,
  tiles: z.number().int().min(1).max(20).default(1),
});

const InteractRequestSchema = z.strictObject({
  direction: DirectionSchema.optional(),
});

const AdvanceRequestSchema = z.strictObject({});

const WaitRequestSchema = z.strictObject({
  until: z.enum(["ready", "stable", "phase-change"]),
  maxFrames: z.number().int().min(1).max(1800).default(600),
});

const NavigateRequestSchema = z.union([
  z.strictObject({
    x: z.number().int(),
    y: z.number().int(),
    maxSteps: z.number().int().min(1).max(200).default(64),
    searchRadius: z.number().int().min(1).max(20).default(12),
  }),
  z.strictObject({
    exitId: z.string().regex(/^(?:connection|warp):(0|[1-9]\d*)$/u),
    maxSteps: z.number().int().min(1).max(200).default(64),
  }),
]);

const BattleMoveRequestSchema = z.union([
  z.strictObject({
    slot: z.number().int().min(1).max(4),
    targetBattler: z.number().int().min(0).max(3).optional(),
  }),
  z.strictObject({
    moveId: z.number().int().positive(),
    targetBattler: z.number().int().min(0).max(3).optional(),
  }),
]);

const BattleItemRequestSchema = z.strictObject({
  itemId: z.number().int().positive(),
  partySlot: z.number().int().min(1).max(6).optional(),
});

const BattleSwitchRequestSchema = z.strictObject({
  partySlot: z.number().int().min(1).max(6),
});

const BattleTargetRequestSchema = z.union([
  z.strictObject({ battler: z.number().int().min(0).max(3) }),
  z.strictObject({ partySlot: z.number().int().min(1).max(6) }),
]);

const EmptyRequestSchema = z.strictObject({});

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    throw new Error("Request body must be valid JSON", { cause: error });
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function tapResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Routed> {
  const parsed = TapRequestSchema.parse(await parseJsonBody(request));
  const commandInput = parseCommandInput(parsed.command);
  if (commandInput === undefined) {
    return {
      response: jsonResponse(
        {
          error: "tap requires one valid button without a quantity or modifier",
        },
        400,
      ),
      requestMeta: parsed,
      logBody: { error: "invalid tap button" },
    };
  }
  if (commandInput.quantity !== 1 || commandInput.modifier !== undefined) {
    return {
      response: jsonResponse(
        { error: "tap requires one button without quantity or modifier" },
        400,
      ),
      requestMeta: parsed,
      logBody: { error: "invalid tap button" },
    };
  }
  const outcome = await context.controller.tap(
    commandInput.command,
    parsed.repeat,
  );
  return {
    response: jsonResponse(outcome),
    requestMeta: parsed,
    logBody: outcome,
  };
}

export async function moveResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Routed> {
  const parsed = MoveRequestSchema.parse(await parseJsonBody(request));
  const outcome = await context.controller.move(parsed.direction, parsed.tiles);
  return {
    response: jsonResponse(outcome),
    requestMeta: parsed,
    logBody: outcome,
  };
}

export async function interactResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Routed> {
  const parsed = InteractRequestSchema.parse(await parseJsonBody(request));
  const outcome = await context.controller.interact(parsed.direction);
  return {
    response: jsonResponse(outcome),
    requestMeta: parsed,
    logBody: outcome,
  };
}

export async function advanceResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Routed> {
  const parsed = AdvanceRequestSchema.parse(await parseJsonBody(request));
  const outcome = await context.controller.advance();
  return {
    response: jsonResponse(outcome),
    requestMeta: parsed,
    logBody: outcome,
  };
}

export async function waitResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Routed> {
  const parsed = WaitRequestSchema.parse(await parseJsonBody(request));
  const condition: WaitCondition = parsed.until;
  const outcome = await context.controller.waitFor(condition, parsed.maxFrames);
  return {
    response: jsonResponse(outcome),
    requestMeta: parsed,
    logBody: outcome,
  };
}

export function mapResponse(
  context: GoalControlContext,
  request: Request,
): Routed {
  const url = new URL(request.url);
  const rawRadius = url.searchParams.get("radius") ?? "8";
  const radius = Number.parseInt(rawRadius, 10);
  if (!Number.isInteger(radius) || String(radius) !== rawRadius) {
    return {
      response: jsonResponse({ error: "radius must be an integer" }, 400),
      requestMeta: { radius: rawRadius },
      logBody: { error: "invalid radius" },
    };
  }
  const map = readGameMap(context.emulator, radius);
  return {
    response: jsonResponse(map),
    requestMeta: { radius },
    logBody: map,
  };
}

export function mapExitsResponse(context: GoalControlContext): Routed {
  const exits = readGameMapExits(context.emulator);
  return {
    response: jsonResponse(exits),
    logBody: exits,
  };
}

export async function navigateResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Routed> {
  const parsed = NavigateRequestSchema.parse(await parseJsonBody(request));
  const outcome =
    "exitId" in parsed
      ? await context.controller.navigateExit(parsed.exitId, parsed.maxSteps)
      : await context.controller.navigate(
          { x: parsed.x, y: parsed.y },
          parsed.maxSteps,
          parsed.searchRadius,
        );
  return {
    response: jsonResponse(outcome),
    requestMeta: parsed,
    logBody: outcome,
  };
}

async function battleMoveResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Routed> {
  const parsed = BattleMoveRequestSchema.parse(await parseJsonBody(request));
  const outcome = await context.controller.battleMove({
    ...("slot" in parsed ? { slot: parsed.slot } : { moveId: parsed.moveId }),
    ...(parsed.targetBattler === undefined
      ? {}
      : { targetBattler: parsed.targetBattler }),
  });
  return {
    response: jsonResponse(outcome),
    requestMeta: parsed,
    logBody: outcome,
  };
}

async function battleItemResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Routed> {
  const parsed = BattleItemRequestSchema.parse(await parseJsonBody(request));
  const outcome = await context.controller.battleItem(
    parsed.itemId,
    parsed.partySlot,
  );
  return {
    response: jsonResponse(outcome),
    requestMeta: parsed,
    logBody: outcome,
  };
}

async function battleRunResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Routed> {
  const parsed = EmptyRequestSchema.parse(await parseJsonBody(request));
  const outcome = await context.controller.battleRun();
  return {
    response: jsonResponse(outcome),
    requestMeta: parsed,
    logBody: outcome,
  };
}

async function battleSwitchResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Routed> {
  const parsed = BattleSwitchRequestSchema.parse(await parseJsonBody(request));
  const outcome = await context.controller.battleSwitch(parsed.partySlot);
  return {
    response: jsonResponse(outcome),
    requestMeta: parsed,
    logBody: outcome,
  };
}

async function battleTargetResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Routed> {
  const parsed = BattleTargetRequestSchema.parse(await parseJsonBody(request));
  const battler =
    "battler" in parsed
      ? parsed.battler
      : context.controller
          .observe()
          .battle?.battlers.find(
            (candidate) =>
              candidate.side === "player" &&
              candidate.active &&
              candidate.partyIndex === parsed.partySlot - 1,
          )?.battler;
  if (battler === undefined) {
    throw new Error("requested party slot is not an active battle target");
  }
  const outcome = await context.controller.battleTarget(battler);
  return {
    response: jsonResponse(outcome),
    requestMeta: parsed,
    logBody: outcome,
  };
}

export async function routeSemanticRequest(
  context: GoalControlContext,
  request: Request,
): Promise<Routed | undefined> {
  const url = new URL(request.url);
  switch (`${request.method} ${url.pathname}`) {
    case "POST /tap":
      return await tapResponse(context, request);
    case "POST /move":
      return await moveResponse(context, request);
    case "POST /navigate":
      return await navigateResponse(context, request);
    case "POST /battle/move":
      return await battleMoveResponse(context, request);
    case "POST /battle/item":
      return await battleItemResponse(context, request);
    case "POST /battle/run":
      return await battleRunResponse(context, request);
    case "POST /battle/switch":
      return await battleSwitchResponse(context, request);
    case "POST /battle/target":
      return await battleTargetResponse(context, request);
    case "POST /interact":
      return await interactResponse(context, request);
    case "POST /advance":
      return await advanceResponse(context, request);
    case "POST /wait":
      return await waitResponse(context, request);
    default:
      return undefined;
  }
}
