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
it("reuses ordinary sessions but brackets every isolated scene with its own fresh lifetime", async () => {
  let id = 0;
  const events: string[] = [];
  const results = await runScenarioSessions(
    [scenario("a"), scenario("b"), scenario("c", "fresh"), scenario("d")],
    async () => {
      const owner = ++id;
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
    },
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
