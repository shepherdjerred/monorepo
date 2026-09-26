import { describe, expect, test } from "vitest";
import { z } from "zod";

import type { LinearIssue } from "#src/domain/schemas.ts";
import {
  isEligibleIssue,
  LinearClient,
  providerForIssue,
  selectIssue,
} from "#src/integrations/linear.ts";
import type { CommandRunner } from "#src/runtime/process.ts";

function issue(input: {
  identifier: string;
  priority?: number;
  createdAt?: string;
  labels?: string[];
  stateType?: string;
}): LinearIssue {
  return {
    id: input.identifier,
    identifier: input.identifier,
    title: input.identifier,
    description: null,
    url: `https://linear.app/example/issue/${input.identifier}`,
    priority: input.priority ?? 0,
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

function recordingRunner(recorded: string[][]): CommandRunner {
  return async (args) => {
    recorded.push([...args]);
    if (args[2] === "label") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          nodes: [
            { id: "codex-id", name: "agent:codex" },
            { id: "needs-human-id", name: "agent:needs-human" },
            { id: "ready-id", name: "agent:ready" },
          ],
        }),
        stderr: "",
        timedOut: false,
      };
    }
    if (args[2] === "api") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: { issueUpdate: { success: true } },
        }),
        stderr: "",
        timedOut: false,
      };
    }
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  };
}

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
  const call = recorded.find((args) => args[2] === "api");
  expect(call).toBeDefined();
  const raw = call?.[call.indexOf("--variables-json") + 1] ?? "{}";
  return ApiVariablesSchema.parse(JSON.parse(raw));
}

describe("Linear label mutations", () => {
  test("needsHuman adds the home-team label by ID", async () => {
    const recorded: string[][] = [];
    const client = new LinearClient("SJ", recordingRunner(recorded));
    await client.needsHuman(
      issue({ identifier: "AI-3", labels: ["agent:codex"] }),
      "reason",
    );
    expect(recorded.flat()).not.toContain("--add-label");
    expect(apiVariables(recorded)).toEqual({
      id: "AI-3",
      add: ["needs-human-id"],
      remove: [],
    });
  });

  test("claim removes legacy ready by ID and keeps the provider", async () => {
    const recorded: string[][] = [];
    const client = new LinearClient("SJ", recordingRunner(recorded));
    await client.claim(
      issue({ identifier: "AI-3", labels: ["agent:codex", "agent:ready"] }),
    );
    expect(recorded.flat()).not.toContain("--remove-label");
    expect(apiVariables(recorded)).toEqual({
      id: "AI-3",
      add: [],
      remove: ["ready-id"],
    });
  });

  test("complete strips the provider label by ID", async () => {
    const recorded: string[][] = [];
    const client = new LinearClient("SJ", recordingRunner(recorded));
    await client.complete(
      issue({ identifier: "AI-3", labels: ["agent:codex"] }),
      "https://example.com/pr/1",
    );
    expect(apiVariables(recorded)).toEqual({
      id: "AI-3",
      add: [],
      remove: ["codex-id"],
    });
  });
});
