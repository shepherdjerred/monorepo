import { z } from "zod";

import type { LinearIssue } from "#src/domain/schemas.ts";
import type { CommandResult, CommandRunner } from "#src/runtime/process.ts";

function respond(stdout: string): Promise<CommandResult> {
  return Promise.resolve({ exitCode: 0, stdout, stderr: "", timedOut: false });
}

function apiVariables(args: readonly string[]): unknown {
  return JSON.parse(args[args.indexOf("--variables-json") + 1] ?? "{}");
}

export function defaultTeams(): Record<string, { id: string; name: string }[]> {
  return {
    SJ: [
      { id: "sj-codex-id", name: "agent:codex" },
      { id: "sj-needs-human-id", name: "agent:needs-human" },
      { id: "sj-ready-id", name: "agent:ready" },
    ],
    AI: [
      { id: "ai-codex-id", name: "agent:codex" },
      { id: "ai-autonomous-id", name: "agent:autonomous" },
      { id: "ai-ready-id", name: "agent:ready" },
    ],
  };
}

export function defaultStates(): Record<
  string,
  { name: string; type: string; position: number }[]
> {
  return {
    SJ: [
      { name: "In Progress", type: "started", position: 2 },
      { name: "Done", type: "completed", position: 3 },
    ],
    AI: [
      { name: "In Progress", type: "started", position: 2 },
      { name: "Done", type: "completed", position: 3 },
    ],
  };
}

const TeamKeySchema = z.object({ key: z.string() });

export function fakeLinearRunner(
  recorded: string[][] = [],
  options: {
    teams?: Record<string, { id: string; name: string }[]>;
    states?: Record<string, { name: string; type: string; position: number }[]>;
    mutateSuccess?: boolean;
    refreshNodes?: LinearIssue[];
  } = {},
): CommandRunner {
  const {
    teams = defaultTeams(),
    states = defaultStates(),
    mutateSuccess = true,
    refreshNodes = [],
  } = options;
  return (args) => {
    recorded.push([...args]);
    if (args[2] === "issue" && args[3] === "query") {
      return respond(JSON.stringify({ nodes: refreshNodes }));
    }
    if (args[2] === "api" && args[3]?.includes("teams(") === true) {
      const variables = TeamKeySchema.parse(apiVariables(args));
      return respond(
        JSON.stringify({
          data: {
            teams: {
              nodes: [{ states: { nodes: states[variables.key] ?? [] } }],
            },
          },
        }),
      );
    }
    if (args[2] === "api" && args[3]?.includes("issue(id:") === true) {
      const variables = z.object({ id: z.string() }).parse(apiVariables(args));
      return respond(
        JSON.stringify({
          data: {
            issue:
              refreshNodes.find((issue) => issue.identifier === variables.id) ??
              null,
          },
        }),
      );
    }
    if (args[2] === "label" && args[3] === "create") {
      const team = args[args.indexOf("--team") + 1] ?? "SJ";
      const name = args[args.indexOf("--name") + 1] ?? "";
      const created = {
        id: `${team.toLowerCase()}-${name.replace(/^agent:/, "")}-id`,
        name,
      };
      teams[team] = [...(teams[team] ?? []), created];
      return respond(JSON.stringify(created));
    }
    if (args[2] === "label") {
      const team = args[args.indexOf("--team") + 1] ?? "SJ";
      return respond(JSON.stringify({ nodes: teams[team] ?? [] }));
    }
    if (args[2] === "api") {
      return respond(
        JSON.stringify({
          data: { issueUpdate: { success: mutateSuccess } },
        }),
      );
    }
    return respond("");
  };
}
