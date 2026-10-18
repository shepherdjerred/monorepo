import { describe, expect, test } from "vitest";
import { z } from "zod";

import type { TrackerIssue } from "#src/domain/schemas.ts";
import {
  defaultTeams,
  fakeTrackerRunner,
} from "#src/integrations/fake-tracker.ts";
import {
  isEligibleIssue,
  TrackerClient,
  providerForIssue,
  selectIssue,
} from "#src/integrations/tracker.ts";

function issue(input: {
  identifier: string;
  priority?: number;
  createdAt?: string;
  labels?: string[];
  stateType?: string;
  teamKey?: string | null;
}): TrackerIssue {
  return {
    id: input.identifier,
    identifier: input.identifier,
    title: input.identifier,
    description: null,
    url: `https://tracker.tailnet-1a49.ts.net/issues/${input.identifier}`,
    priority: input.priority ?? 0,
    ...(input.teamKey === null
      ? {}
      : {
          team: {
            key:
              input.teamKey ?? z.string().parse(input.identifier.split("-")[0]),
          },
        }),
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    state: { name: "Todo", type: input.stateType ?? "unstarted" },
    labels: {
      nodes: (input.labels ?? ["agent:codex"]).map((name) => ({
        name,
      })),
    },
  };
}

describe("Tracker queue selection", () => {
  test("reads Toolkit's array output and preserves durable issue snapshots", async () => {
    const selected = issue({ identifier: "AI-99", teamKey: "AI" });
    const client = new TrackerClient(
      "AI",
      fakeTrackerRunner([], { refreshNodes: [selected] }),
    );
    expect(await client.nextIssue()).toEqual(selected);
    expect(await client.refreshIssue("AI-99")).toEqual(selected);
    expect(await client.labelNames()).toEqual(
      new Set(["agent:codex", "agent:autonomous", "agent:ready"]),
    );
  });

  test("includes flattened CLI comments as quoted agent context", async () => {
    const client = new TrackerClient("AI", async () => ({
      exitCode: 0,
      stderr: "",
      timedOut: false,
      stdout: JSON.stringify({
        description: null,
        comments: [{ body: "  A useful comment  " }, { body: " " }],
      }),
    }));
    expect(await client.agentContext("AI-99")).toBe(
      'Tracker comments present for agent context:\n"A useful comment"',
    );
  });

  test("a lone provider label is enough, in any team or state", () => {
    expect(providerForIssue(issue({ identifier: "SJ-1" }))).toBe("codex");
    expect(isEligibleIssue(issue({ identifier: "SJ-1" }))).toBe(true);
    for (const stateType of ["triage", "backlog", "unstarted", "started"]) {
      expect(
        isEligibleIssue(
          issue({ identifier: "SJ-1", stateType, labels: ["agent:codex"] }),
        ),
      ).toBe(true);
    }
    expect(
      isEligibleIssue(
        issue({
          identifier: "SJ-2",
          labels: ["agent:codex", "agent:needs-human"],
        }),
      ),
    ).toBe(false);
    expect(isEligibleIssue(issue({ identifier: "SJ-3", labels: [] }))).toBe(
      false,
    );
    for (const stateType of ["completed", "canceled"]) {
      expect(
        isEligibleIssue(
          issue({ identifier: "SJ-4", stateType, labels: ["agent:codex"] }),
        ),
      ).toBe(false);
    }
  });

  test("chooses highest priority, then oldest", () => {
    expect(
      selectIssue([
        issue({ identifier: "SJ-1", priority: 3 }),
        issue({
          identifier: "SJ-2",
          priority: 1,
          createdAt: "2026-02-01T00:00:00.000Z",
        }),
        issue({
          identifier: "SJ-3",
          priority: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      ])?.identifier,
    ).toBe("SJ-3");
  });
});

const ApiVariablesSchema = z.object({
  id: z.string(),
  add: z.array(z.string()),
  remove: z.array(z.string()),
});

function apiVariables(recorded: string[][]): {
  id: string;
  add: string[];
  remove: string[];
} {
  const call = recorded.find(
    (args) =>
      args[2] === "issue" &&
      args[3] === "update" &&
      (args.includes("--add-label") || args.includes("--remove-label")),
  );
  expect(call).toBeDefined();
  if (call === undefined) throw new Error("Missing label mutation");
  return ApiVariablesSchema.parse({
    id: call[4],
    add: call.flatMap((arg, index) =>
      arg === "--add-label" ? [call[index + 1]] : [],
    ),
    remove: call.flatMap((arg, index) =>
      arg === "--remove-label" ? [call[index + 1]] : [],
    ),
  });
}

describe("Tracker label mutations", () => {
  test("needsHuman adds the home-team label by name", async () => {
    const recorded: string[][] = [];
    const client = new TrackerClient("SJ", fakeTrackerRunner(recorded));
    await client.needsHuman(
      issue({ identifier: "AI-3", labels: ["agent:codex"] }),
      "reason",
    );
    expect(recorded.flat()).toContain("--add-label");
    expect(
      recorded.some(
        (args) =>
          args[1] === "tracker" && args[2] === "issue" && args[3] === "update",
      ),
    ).toBe(true);
    expect(apiVariables(recorded)).toEqual({
      id: "AI-3",
      add: ["agent:needs-human"],
      remove: [],
    });
  });

  test("needsHuman provisions the team label on first park", async () => {
    const recorded: string[][] = [];
    const client = new TrackerClient("SJ", fakeTrackerRunner(recorded));
    await client.needsHuman(
      issue({
        identifier: "AI-3",
        teamKey: "AI",
        labels: ["agent:codex"],
      }),
      "reason",
    );
    const create = recorded.find(
      (args) => args[2] === "label" && args[3] === "create",
    );
    expect(create).toEqual(
      expect.arrayContaining(["--team", "AI", "--name", "agent:needs-human"]),
    );
    expect(apiVariables(recorded)).toEqual({
      id: "AI-3",
      add: ["agent:needs-human"],
      remove: [],
    });
  });

  test("claim removes legacy ready by name and keeps the provider", async () => {
    const recorded: string[][] = [];
    const client = new TrackerClient("SJ", fakeTrackerRunner(recorded));
    await client.claim(
      issue({ identifier: "AI-3", labels: ["agent:codex", "agent:ready"] }),
    );
    expect(recorded.flat()).toContain("--remove-label");
    expect(apiVariables(recorded)).toEqual({
      id: "AI-3",
      add: [],
      remove: ["agent:ready"],
    });
  });

  test("complete strips the provider label by name", async () => {
    const recorded: string[][] = [];
    const client = new TrackerClient("SJ", fakeTrackerRunner(recorded));
    await client.complete(
      issue({ identifier: "AI-3", labels: ["agent:codex"] }),
      "https://example.com/pr/1",
    );
    expect(apiVariables(recorded)).toEqual({
      id: "AI-3",
      add: [],
      remove: ["agent:codex"],
    });
  });

  test("complete keeps the issue non-terminal when cleanup fails", async () => {
    const recorded: string[][] = [];
    const client = new TrackerClient(
      "SJ",
      fakeTrackerRunner(recorded, { mutateSuccess: false }),
    );
    await expect(
      client.complete(
        issue({ identifier: "AI-3", labels: ["agent:codex"] }),
        "https://example.com/pr/1",
      ),
    ).rejects.toThrow(/label mutation failed/);
    expect(
      recorded.filter(
        (args) => args.includes("--state") && args.includes("completed"),
      ),
    ).toEqual([]);
  });

  test("claim resolves the preferred started state by type", async () => {
    const recorded: string[][] = [];
    const client = new TrackerClient("SJ", fakeTrackerRunner(recorded));
    await client.claim(issue({ identifier: "SJ-9", labels: ["agent:codex"] }));
    const update = recorded.find(
      (args) => args[2] === "issue" && args[3] === "update",
    );
    expect(update).toEqual(expect.arrayContaining(["--state", "started"]));
  });

  test("claim falls back to positional started state", async () => {
    const recorded: string[][] = [];
    const states = {
      XX: [{ name: "Doing", type: "started", position: 1 }],
    };
    const client = new TrackerClient(
      "SJ",
      fakeTrackerRunner(recorded, { teams: defaultTeams(), states }),
    );
    await client.claim(
      issue({ identifier: "XX-1", teamKey: "XX", labels: ["agent:codex"] }),
    );
    const update = recorded.find(
      (args) => args[2] === "issue" && args[3] === "update",
    );
    expect(update).toEqual(expect.arrayContaining(["--state", "started"]));
  });

  test("rejects unsuccessful label mutations", async () => {
    const recorded: string[][] = [];
    const client = new TrackerClient(
      "SJ",
      fakeTrackerRunner(recorded, { mutateSuccess: false }),
    );
    await expect(
      client.needsHuman(
        issue({ identifier: "SJ-1", labels: ["agent:codex"] }),
        "reason",
      ),
    ).rejects.toThrow(/label mutation failed/);
  });

  test("mutations reject issues without a team", async () => {
    const recorded: string[][] = [];
    const client = new TrackerClient("SJ", fakeTrackerRunner(recorded));
    await expect(
      client.claim(
        issue({ identifier: "XX-1", teamKey: null, labels: ["agent:codex"] }),
      ),
    ).rejects.toThrow(/has no team/);
  });

  test("legacy snapshots refetch the team instead of wedging", async () => {
    const recorded: string[][] = [];
    const refreshed = issue({
      identifier: "AI-1",
      teamKey: "AI",
      labels: ["agent:codex", "agent:ready"],
    });
    const client = new TrackerClient(
      "SJ",
      fakeTrackerRunner(recorded, { refreshNodes: [refreshed] }),
    );
    await client.claim(
      issue({
        identifier: "AI-1",
        teamKey: null,
        labels: ["agent:codex", "agent:ready"],
      }),
    );
    const query = recorded.find(
      (args) => args[2] === "issue" && args[3] === "view",
    );
    expect(query).toBeDefined();
    expect(query?.[4]).toBe("AI-1");
    expect(apiVariables(recorded)).toEqual({
      id: "AI-1",
      add: [],
      remove: ["agent:ready"],
    });
  });

  test("requeue removes the park label by name", async () => {
    const recorded: string[][] = [];
    const client = new TrackerClient("SJ", fakeTrackerRunner(recorded));
    await client.requeue(
      issue({
        identifier: "SJ-1",
        labels: ["agent:codex", "agent:needs-human"],
      }),
    );
    expect(apiVariables(recorded)).toEqual({
      id: "SJ-1",
      add: [],
      remove: ["agent:needs-human"],
    });
  });
});
