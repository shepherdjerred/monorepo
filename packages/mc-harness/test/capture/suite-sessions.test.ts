import { it, expect } from "vitest";
import { runScenarioSessions } from "#src/capture/suite/sessions.ts";
import type { SuiteScenario } from "#src/capture/suite/define.ts";

function scenario(id: string, isolation?: "fresh"): SuiteScenario {
  return {
    id,
    isolation,
    world: "world",
    anchor: [0, 64, 0],
    helpers: [],
    shots: [],
    scene: {
      name: id,
      description: id,
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
      staging: [0, 0, 0],
      inspectors: [],
      setup: () => Promise.resolve(),
      run: () => Promise.resolve(),
    },
  };
}
function trackedSessions(events: string[]) {
  let next = 0;
  return async () => {
    const owner = ++next;
    events.push(`start ${owner.toString()}`);
    return {
      owner,
      prepare: async (s: SuiteScenario) => {
        events.push(`prepare ${owner.toString()} ${s.id}`);
      },
      stop: async () => {
        events.push(`stop ${owner.toString()}`);
      },
    };
  };
}
it("reuses ordinary sessions but brackets every isolated scene with its own fresh lifetime", async () => {
  const events: string[] = [];
  const results = await runScenarioSessions(
    [scenario("a"), scenario("b"), scenario("c", "fresh"), scenario("d")],
    trackedSessions(events),
    async (s, session) => {
      events.push(`execute ${session.owner.toString()} ${s.id}`);
      return s.id;
    },
  );
  expect(results).toEqual(["a", "b", "c", "d"]);
  expect(events).toEqual([
    "start 1",
    "prepare 1 a",
    "execute 1 a",
    "prepare 1 b",
    "execute 1 b",
    "stop 1",
    "start 2",
    "prepare 2 c",
    "execute 2 c",
    "stop 2",
    "start 3",
    "prepare 3 d",
    "execute 3 d",
    "stop 3",
  ]);
});
it("stops the owned session when execution fails", async () => {
  let stopped = 0;
  await expect(
    runScenarioSessions(
      [scenario("a")],
      async () => ({
        prepare: () => Promise.resolve(),
        stop: async () => {
          stopped++;
        },
      }),
      async () => {
        throw new Error("capture refused");
      },
    ),
  ).rejects.toThrow("capture refused");
  expect(stopped).toBe(1);
});
it("does not return publishable results or start another session after failed disposal", async () => {
  let started = 0,
    stopped = 0;
  await expect(
    runScenarioSessions(
      [scenario("a", "fresh"), scenario("b")],
      async () => {
        started++;
        return {
          prepare: () => Promise.resolve(),
          stop: async () => {
            stopped++;
            throw new Error("disposal failed");
          },
        };
      },
      async () => "private capture",
    ),
  ).rejects.toThrow("disposal failed");
  expect(started).toBe(1);
  expect(stopped).toBe(1);
});

const frameMiss =
  "capture-214125f2-34e2-41ee-86cc-f3ca3c186903: java.lang.IllegalStateException: Rendered capture missed frame 22";

it("disposes the failed real-time recording's world before one complete scenario retake", async () => {
  const events: string[] = [];
  const results = await runScenarioSessions(
    [scenario("lift"), scenario("next")],
    trackedSessions(events),
    async (s, session) => {
      events.push(`execute ${session.owner.toString()} ${s.id}`);
      if (session.owner === 1) throw new Error(frameMiss);
      return `${s.id}: strict complete recording`;
    },
  );
  expect(results).toEqual([
    "lift: strict complete recording",
    "next: strict complete recording",
  ]);
  expect(events).toEqual([
    "start 1",
    "prepare 1 lift",
    "execute 1 lift",
    "stop 1",
    "start 2",
    "prepare 2 lift",
    "execute 2 lift",
    "prepare 2 next",
    "execute 2 next",
    "stop 2",
  ]);
});

it("fails after a second missed recording frame and disposes both attempts", async () => {
  let started = 0,
    stopped = 0;
  await expect(
    runScenarioSessions(
      [scenario("lift", "fresh")],
      async () => {
        started++;
        return {
          prepare: () => Promise.resolve(),
          stop: async () => {
            stopped++;
          },
        };
      },
      async () => {
        throw new Error(frameMiss);
      },
    ),
  ).rejects.toThrow(frameMiss);
  expect(started).toBe(2);
  expect(stopped).toBe(2);
});

it("refuses a recording retake when disposing its failed session fails", async () => {
  let started = 0;
  await expect(
    runScenarioSessions(
      [scenario("lift")],
      async () => {
        started++;
        return {
          prepare: () => Promise.resolve(),
          stop: () => Promise.reject(new Error("disposal failed")),
        };
      },
      async () => {
        throw new Error(frameMiss);
      },
    ),
  ).rejects.toThrow("disposal failed");
  expect(started).toBe(1);
});
