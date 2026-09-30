import { describe, expect, test } from "vitest";
import { z } from "zod";

import type { LinearIssue } from "#src/domain/schemas.ts";
import {
  defaultTeams,
  fakeLinearRunner,
} from "#src/integrations/fake-linear.ts";
import {
  isEligibleIssue,
  LinearClient,
  providerForIssue,
  selectIssue,
} from "#src/integrations/linear.ts";

function issue(input: {
  identifier: string;
  priority?: number;
  createdAt?: string;
  labels?: string[];
  stateType?: string;
  teamKey?: string | null;
}): LinearIssue {
  return {
    id: input.identifier,
    identifier: input.identifier,
    title: input.identifier,
    description: null,
    url: `https://linear.app/example/issue/${input.identifier}`,
    priority: input.priority ?? 0,
    ...(input.teamKey === null ? {} : { team: { key: input.teamKey ?? "SJ" } }),
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    state: { name: "Todo", type: input.stateType ?? "unstarted" },
    labels: {
      nodes: (input.labels ?? ["agent:codex"]).map((name) => ({
        name,
      })),
    },
  };
}

describe("Linear queue selection", () => {
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
    (args) => args[2] === "api" && args[3]?.includes("issueUpdate") === true,
  );
  expect(call).toBeDefined();
  const raw = call?.[call.indexOf("--variables-json") + 1] ?? "{}";
  return ApiVariablesSchema.parse(JSON.parse(raw));
}

describe("Linear label mutations", () => {
  test("needsHuman adds the home-team label by ID", async () => {
    const recorded: string[][] = [];
    const client = new LinearClient("SJ", fakeLinearRunner(recorded));
    await client.needsHuman(
      issue({ identifier: "AI-3", labels: ["agent:codex"] }),
      "reason",
    );
    expect(recorded.flat()).not.toContain("--add-label");
    const call = recorded.find(
      (args) => args[2] === "api" && args[3]?.includes("issueUpdate") === true,
    );
    expect(call?.[3]).toContain("issueUpdate(id: $id, input:");
    expect(apiVariables(recorded)).toEqual({
      id: "AI-3",
      add: ["sj-needs-human-id"],
      remove: [],
    });
  });

  test("needsHuman provisions the team label on first park", async () => {
    const recorded: string[][] = [];
    const client = new LinearClient("SJ", fakeLinearRunner(recorded));
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
      add: ["ai-needs-human-id"],
      remove: [],
    });
  });

  test("claim removes legacy ready by ID and keeps the provider", async () => {
    const recorded: string[][] = [];
    const client = new LinearClient("SJ", fakeLinearRunner(recorded));
    await client.claim(
      issue({ identifier: "AI-3", labels: ["agent:codex", "agent:ready"] }),
    );
    expect(recorded.flat()).not.toContain("--remove-label");
    expect(apiVariables(recorded)).toEqual({
      id: "AI-3",
      add: [],
      remove: ["sj-ready-id"],
    });
  });

  test("complete strips the provider label by ID", async () => {
    const recorded: string[][] = [];
    const client = new LinearClient("SJ", fakeLinearRunner(recorded));
    await client.complete(
      issue({ identifier: "AI-3", labels: ["agent:codex"] }),
      "https://example.com/pr/1",
    );
    expect(apiVariables(recorded)).toEqual({
      id: "AI-3",
      add: [],
      remove: ["sj-codex-id"],
    });
  });

  test("complete keeps the issue non-terminal when cleanup fails", async () => {
    const recorded: string[][] = [];
    const client = new LinearClient(
      "SJ",
      fakeLinearRunner(recorded, { mutateSuccess: false }),
    );
    await expect(
      client.complete(
        issue({ identifier: "AI-3", labels: ["agent:codex"] }),
        "https://example.com/pr/1",
      ),
    ).rejects.toThrow(/label mutation failed/);
    expect(
      recorded.filter((args) => args[2] === "issue" && args[3] === "update"),
    ).toEqual([]);
  });

  test("claim resolves the preferred started state by type", async () => {
    const recorded: string[][] = [];
    const client = new LinearClient("SJ", fakeLinearRunner(recorded));
    await client.claim(issue({ identifier: "SJ-9", labels: ["agent:codex"] }));
    const update = recorded.find(
      (args) => args[2] === "issue" && args[3] === "update",
    );
    expect(update).toEqual(expect.arrayContaining(["--state", "In Progress"]));
  });

  test("claim falls back to positional started state", async () => {
    const recorded: string[][] = [];
    const states = {
      XX: [{ name: "Doing", type: "started", position: 1 }],
    };
    const client = new LinearClient(
      "SJ",
      fakeLinearRunner(recorded, { teams: defaultTeams(), states }),
    );
    await client.claim(
      issue({ identifier: "XX-1", teamKey: "XX", labels: ["agent:codex"] }),
    );
    const update = recorded.find(
      (args) => args[2] === "issue" && args[3] === "update",
    );
    expect(update).toEqual(expect.arrayContaining(["--state", "Doing"]));
  });

  test("rejects unsuccessful label mutations", async () => {
    const recorded: string[][] = [];
    const client = new LinearClient(
      "SJ",
      fakeLinearRunner(recorded, { mutateSuccess: false }),
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
    const client = new LinearClient("SJ", fakeLinearRunner(recorded));
    await expect(
      client.claim(
        issue({ identifier: "XX-1", teamKey: null, labels: ["agent:codex"] }),
      ),
    ).rejects.toThrow(/has no team/);
  });

  test("legacy snapshots refetch the team instead of wedging", async () => {
    const recorded: string[][] = [];
    const refreshed = issue({
      identifier: "XX-1",
      teamKey: "AI",
      labels: ["agent:codex", "agent:ready"],
    });
    const client = new LinearClient(
      "SJ",
      fakeLinearRunner(recorded, { refreshNodes: [refreshed] }),
    );
    await client.claim(
      issue({
        identifier: "XX-1",
        teamKey: null,
        labels: ["agent:codex", "agent:ready"],
      }),
    );
    const query = recorded.find(
      (args) => args[2] === "issue" && args[3] === "query",
    );
    expect(query).toEqual(
      expect.arrayContaining(["--all-teams", "--search", "XX-1"]),
    );
    expect(apiVariables(recorded)).toEqual({
      id: "XX-1",
      add: [],
      remove: ["ai-ready-id"],
    });
  });

  test("requeue removes the park label by ID", async () => {
    const recorded: string[][] = [];
    const client = new LinearClient("SJ", fakeLinearRunner(recorded));
    await client.requeue(
      issue({
        identifier: "SJ-1",
        labels: ["agent:codex", "agent:needs-human"],
      }),
    );
    expect(apiVariables(recorded)).toEqual({
      id: "SJ-1",
      add: [],
      remove: ["sj-needs-human-id"],
    });
  });
});
