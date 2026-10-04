import {
  ActorActionRequestSchemas,
  ActorActionResponseSchema,
  type ActorActionResponse,
  type ActorAction,
  ActorObservationSchema,
  type BlockPos,
  type BridgeEvent,
  CommandResponseSchema,
  EventsResponseSchema,
  InfoResponseSchema,
  RegionReadResponseSchema,
  type WeOp,
  WeRunResponseSchema,
} from "#protocol/bridge.ts";
import type {
  ActorHandle,
  EventMatch,
  Expect,
  Scenario,
  ScenarioContext,
  Within,
} from "#playtest/define.ts";
import type { DaemonClient } from "#playtest/daemon-client.ts";

const DEFAULT_EVENTUALLY_MS = 10_000;
const DEFAULT_EVERY_MS = 200;
const DEFAULT_WITHIN_MS = 5000;
const EVENT_PAGE = 500;
/** Larger than any cursor, so the bridge answers with its newest sequence number. */
const NEWEST = Number.MAX_SAFE_INTEGER;

export class AssertionFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionFailed";
  }
}

/** An actor action that did not take effect (`ok: false`). */
export class ActionFailed extends Error {
  constructor(
    readonly actor: string,
    readonly response: ActorActionResponse,
  ) {
    super(`${actor}: ${response.detail}`);
    this.name = "ActionFailed";
  }
}

export type StepRecord = {
  name: string;
  status: "passed" | "failed" | "errored";
  durationMs: number;
  error?: string;
};
export type AssertionRecord = {
  description: string;
  passed: boolean;
  detail?: string;
};

/** What a run accumulates for its report. */
export class Recorder {
  readonly steps: StepRecord[] = [];
  readonly assertions: AssertionRecord[] = [];
  readonly notes: string[] = [];
  /** Name of the step running now, for failure attribution. */
  currentStep: string | undefined;
  /** Events at or before this cursor predate the current step. */
  stepCursor = 0;
}

function parseState(state: string): { id: string; props: Map<string, string> } {
  const open = state.indexOf("[");
  const id = open === -1 ? state : state.slice(0, open);
  const props = new Map<string, string>();
  if (open !== -1) {
    for (const pair of state.slice(open + 1, -1).split(",")) {
      const [key = "", value = ""] = pair.split("=");
      if (key.length > 0) {
        props.set(key.trim(), value.trim());
      }
    }
  }
  return { id: id.includes(":") ? id : `minecraft:${id}`, props };
}

/**
 * Whether `actual` (a full state from the bridge) satisfies `expected`: the
 * block ids agree and every property `expected` names has the same value.
 * A bare id matches any properties.
 */
export function blockMatches(actual: string, expected: string): boolean {
  const a = parseState(actual);
  const e = parseState(expected);
  if (a.id !== e.id) {
    return false;
  }
  for (const [key, value] of e.props) {
    if (a.props.get(key) !== value) {
      return false;
    }
  }
  return true;
}

export function eventMatches(event: BridgeEvent, match: EventMatch): boolean {
  if (match.type !== undefined && event.type !== match.type) {
    return false;
  }
  if (match.player !== undefined && event.player !== match.player) {
    return false;
  }
  if (match.text === undefined) {
    return true;
  }
  return typeof match.text === "string"
    ? event.text.includes(match.text)
    : match.text.test(event.text);
}

function describeMatch(match: EventMatch): string {
  const parts = [
    match.type ?? "any",
    ...(match.player === undefined ? [] : [`by ${match.player}`]),
    ...(match.text === undefined ? [] : [`matching ${String(match.text)}`]),
  ];
  return parts.join(" ");
}

function formatPos(pos: BlockPos): string {
  return `${pos.x.toString()},${pos.y.toString()},${pos.z.toString()}`;
}

export type ContextParts = {
  context: ScenarioContext<string>;
  recorder: Recorder;
};

/**
 * Builds the context a scenario's `setup` and `run` receive. At runtime actor
 * names are plain strings; `defineScenario` gives authors the narrow names.
 */
export function createContext(
  scenario: Scenario,
  daemon: DaemonClient,
  recorder: Recorder,
): ContextParts {
  const world = scenario.world ?? "world";

  const events = {
    cursor: async () => {
      const page = await daemon.target(
        EventsResponseSchema,
        "GET",
        `events?since=${NEWEST.toString()}&limit=1`,
      );
      return page.cursor;
    },
    since: async (cursor: number) => {
      const all: BridgeEvent[] = [];
      let next = cursor;
      for (;;) {
        const page = await daemon.target(
          EventsResponseSchema,
          "GET",
          `events?since=${next.toString()}&limit=${EVENT_PAGE.toString()}`,
        );
        all.push(...page.events);
        if (page.events.length < EVENT_PAGE) {
          return all;
        }
        next = page.cursor;
      }
    },
  };

  const record = (description: string, passed: boolean, detail?: string) => {
    recorder.assertions.push({
      description,
      passed,
      ...(detail === undefined ? {} : { detail }),
    });
    if (!passed) {
      throw new AssertionFailed(
        detail === undefined ? description : `${description}: ${detail}`,
      );
    }
  };

  const readBlock = async (pos: BlockPos, blockWorld: string) => {
    const region = await daemon.target(
      RegionReadResponseSchema,
      "POST",
      "region-read",
      { world: blockWorld, min: pos, max: pos },
    );
    const [state] = region.palette;
    if (state === undefined) {
      throw new Error(`region read of ${formatPos(pos)} returned no state`);
    }
    return state;
  };

  const waitFor = (match: EventMatch, since?: number): Within => ({
    within: async (ms = DEFAULT_WITHIN_MS) => {
      const from = since ?? recorder.stepCursor;
      const deadline = Date.now() + ms;
      const description = `event ${describeMatch(match)} within ${ms.toString()}ms`;
      for (;;) {
        const recent = await events.since(from);
        const found = recent.find((event) => eventMatches(event, match));
        if (found !== undefined) {
          record(description, true, found.text);
          return found;
        }
        if (Date.now() >= deadline) {
          record(
            description,
            false,
            `no matching event since #${from.toString()}`,
          );
        }
        await Bun.sleep(DEFAULT_EVERY_MS);
      }
    },
  });

  const actorHandle = (name: string): ActorHandle => {
    const attempt = async (
      action: ActorAction,
      request: Record<string, unknown>,
    ) =>
      daemon.target(
        ActorActionResponseSchema,
        "POST",
        `actors/${encodeURIComponent(name)}/${action}`,
        ActorActionRequestSchemas[action].parse(request),
      );
    const run = async (
      action: ActorAction,
      request: Record<string, unknown>,
    ) => {
      const response = await attempt(action, request);
      if (!response.ok) {
        throw new ActionFailed(name, response);
      }
      return response;
    };
    return {
      name,
      goto: async (pos, options) => run("goto", { pos, ...options }),
      look: async (pos) => run("look", { pos }),
      equip: async (item, options) => run("equip", { item, ...options }),
      command: async (command) => run("command", { command }),
      chat: async (message) => run("chat", { message }),
      break: async (pos) => run("break", { pos }),
      place: async (pos, block) => run("place", { pos, block }),
      use: async (pos) => run("use", { pos }),
      attack: async (target) => run("attack", target),
      observe: async () =>
        daemon.target(
          ActorObservationSchema,
          "GET",
          `actors/${encodeURIComponent(name)}`,
        ),
      attempt,
    };
  };

  const actors: Record<string, ActorHandle> = Object.fromEntries(
    Object.keys(scenario.actors ?? {}).map((name) => [name, actorHandle(name)]),
  );

  const expect: Expect = {
    block: (pos, blockWorld = world) => ({
      toBe: async (state) => {
        const actual = await readBlock(pos, blockWorld);
        record(
          `block ${formatPos(pos)} is ${state}`,
          blockMatches(actual, state),
          `found ${actual}`,
        );
      },
      eventually: async (state, options) => {
        const within = options?.within ?? DEFAULT_EVENTUALLY_MS;
        const every = options?.every ?? DEFAULT_EVERY_MS;
        const deadline = Date.now() + within;
        let actual = await readBlock(pos, blockWorld);
        while (!blockMatches(actual, state) && Date.now() < deadline) {
          await Bun.sleep(every);
          actual = await readBlock(pos, blockWorld);
        }
        record(
          `block ${formatPos(pos)} becomes ${state} within ${within.toString()}ms`,
          blockMatches(actual, state),
          `found ${actual}`,
        );
      },
    }),
    command: (command) => ({
      toMatch: async (pattern) => {
        const result = await daemon.target(
          CommandResponseSchema,
          "POST",
          "command",
          { command },
        );
        const output = result.output.join("\n");
        record(
          `/${command.replace(/^\//u, "")} output matches ${String(pattern)}`,
          pattern.test(output),
          output,
        );
      },
    }),
    event: (match, options) => waitFor(match, options?.since),
    chat: (actor, text) =>
      waitFor({
        type: "chat",
        player: typeof actor === "string" ? actor : actor.name,
        text,
      }),
    log: (text) => waitFor({ type: "log", text }),
    inventory: (actor) => ({
      toContain: async (item, count = 1) => {
        const observation = await actor.observe();
        const id = item.includes(":") ? item : `minecraft:${item}`;
        const total = observation.inventory
          .filter((stack) => stack.item === id)
          .reduce((sum, stack) => sum + stack.count, 0);
        record(
          `${actor.name} holds at least ${count.toString()} ${id}`,
          total >= count,
          `holds ${total.toString()}`,
        );
      },
    }),
    that: (description, passed, detail) => {
      record(description, passed, detail);
    },
  };

  const context: ScenarioContext<string> = {
    world,
    target: {
      id: daemon.targetId,
      info: async () => daemon.target(InfoResponseSchema, "GET", "info"),
    },
    command: async (command) =>
      daemon.target(CommandResponseSchema, "POST", "command", { command }),
    we: async (ops) => {
      const list: WeOp[] = Array.isArray(ops) ? ops : [ops];
      const result = await daemon.target(WeRunResponseSchema, "POST", "we", {
        session: "playtest",
        world,
        ops: list,
      });
      const failed = result.results.find((entry) => !entry.ok);
      if (failed !== undefined) {
        throw new Error(
          `WorldEdit ${failed.command} failed: ${[...failed.errors, ...failed.messages].join("; ")}`,
        );
      }
      return result;
    },
    actors,
    events,
    step: async (name, run) => {
      const started = Date.now();
      recorder.currentStep = name;
      recorder.stepCursor = await events.cursor();
      try {
        const value = await run();
        recorder.steps.push({
          name,
          status: "passed",
          durationMs: Date.now() - started,
        });
        return value;
      } catch (error) {
        recorder.steps.push({
          name,
          status:
            error instanceof AssertionFailed || error instanceof ActionFailed
              ? "failed"
              : "errored",
          durationMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    expect,
    sleep: async (ms) => {
      await Bun.sleep(ms);
    },
    note: (message) => {
      recorder.notes.push(message);
    },
  };
  return { context, recorder };
}
