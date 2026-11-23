import { describe, expect, test } from "vitest";
import { artifact, detail, recipe } from "#lib/delivery/model/testing.ts";
import type { CommandResult } from "#activities/homelab/mining-reset-kubectl.ts";
import {
  parsePlayerList,
  readServerPod,
  runPlayersOfflineStep,
  type PlayersOfflineEffects,
} from "./players-offline.ts";

const KEY = "sub2-step-players-offline";
const chart = artifact({
  id: "chart/minecraft",
  component: "chart:minecraft",
  kind: "chart",
  uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/minecraft-5.2.0.tgz",
  version: "5.2.0",
  character: "c",
});

function current(stages: { key: string; status: "running" }[] = []) {
  return detail(
    recipe(
      {
        repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
        chart: "minecraft",
      },
      "chart:minecraft",
    ),
    chart,
    stages,
  );
}

function pod(ready: boolean) {
  return {
    status: {
      phase: "Running",
      containerStatuses: [{ name: "minecraft-tsmc", ready }],
    },
  };
}

const listed = (stdout: string, exitCode = 0): CommandResult => ({
  stdout,
  stderr: "",
  exitCode,
});
const EMPTY = listed("There are 0 of a max of 20 players online: \n");

function effects(pods: unknown[], reply: CommandResult) {
  const calls: string[] = [];
  const recorded: PlayersOfflineEffects = {
    record: async (_current, key, status, receipt) => {
      calls.push(
        [
          `record ${key} ${status}`,
          receipt.message ?? "",
          ...(receipt.evidence ?? []).map((item) => item.summary),
        ]
          .filter((part) => part !== "")
          .join(" | "),
      );
    },
    pods: async () => {
      calls.push("pods");
      return pods;
    },
    console: async (args) => {
      calls.push(args.join(" "));
      return reply;
    },
  };
  return { calls, effects: recorded };
}

describe("players-offline step", () => {
  test("an empty serving server passes with the console reading as evidence", async () => {
    const run = effects([pod(true)], EMPTY);
    expect(await runPlayersOfflineStep(current(), KEY, run.effects)).toEqual({
      waiting: false,
    });
    expect(run.calls).toEqual([
      `record ${KEY} running`,
      "pods",
      "exec -n minecraft-tsmc minecraft-tsmc-0 -c minecraft-tsmc -- rcon-cli list",
      `record ${KEY} succeeded | {"adapter":"players-offline","server":"serving","online":0,"maximum":20}`,
    ]);
  });

  test("a sleeping or unready server has nobody to disconnect", async () => {
    for (const pods of [[], [pod(false)]]) {
      const run = effects(pods, EMPTY);
      expect(await runPlayersOfflineStep(current(), KEY, run.effects)).toEqual({
        waiting: false,
      });
      expect(run.calls).toEqual([
        `record ${KEY} running`,
        "pods",
        `record ${KEY} succeeded | {"adapter":"players-offline","server":"asleep","online":0}`,
      ]);
    }
  });

  test("online players hold the restart and name their count", async () => {
    const run = effects(
      [pod(true)],
      listed("There are 3 of a max of 20 players online: A, B, C\n"),
    );
    expect(
      await runPlayersOfflineStep(
        current([{ key: KEY, status: "running" }]),
        KEY,
        run.effects,
      ),
    ).toEqual({ waiting: true });
    expect(run.calls.at(0)).toBe("pods");
    expect(run.calls.at(-1)).toBe(
      `record ${KEY} running | ${KEY}: waiting for 3 player(s) to leave`,
    );
  });

  test("an unanswered console proves nothing, so the gate keeps waiting", async () => {
    const run = effects([pod(true)], listed("", 1));
    expect(await runPlayersOfflineStep(current(), KEY, run.effects)).toEqual({
      waiting: true,
    });
    expect(run.calls.at(-1)).toBe(
      `record ${KEY} running | ${KEY}: The Storm console did not answer list (exit 1)`,
    );
  });

  test("an unknown console reply fails the step", async () => {
    const run = effects([pod(true)], listed("Unknown command\n"));
    await expect(
      runPlayersOfflineStep(current(), KEY, run.effects),
    ).rejects.toThrow("The Storm console answered list with an unknown reply");
  });
});

describe("readServerPod", () => {
  const get = "get pod -n minecraft-tsmc minecraft-tsmc-0 -o json";

  test("reads the server Pod from Kubernetes, not Argo CD's resource tree", async () => {
    const calls: string[] = [];
    const pods = await readServerPod(async (args) => {
      calls.push(args.join(" "));
      return { stdout: JSON.stringify(pod(true)), stderr: "", exitCode: 0 };
    });
    expect(calls).toEqual([get]);
    expect(pods).toEqual([pod(true)]);
  });

  test("an absent Pod is a sleeping server", async () => {
    const pods = await readServerPod(async () => ({
      stdout: "",
      stderr:
        'Error from server (NotFound): pods "minecraft-tsmc-0" not found\n',
      exitCode: 1,
    }));
    expect(pods).toEqual([]);
  });

  test("any other failure fails the read", async () => {
    await expect(
      readServerPod(async () => ({
        stdout: "",
        stderr: "Error from server (Forbidden): pods is forbidden\n",
        exitCode: 1,
      })),
    ).rejects.toThrow("Reading minecraft-tsmc-0 failed (exit 1)");
  });
});

function kubernetes(podRead: CommandResult, list: CommandResult) {
  const calls: string[] = [];
  const command = async (args: readonly string[]) => {
    calls.push(args.join(" "));
    return args[0] === "get" ? podRead : list;
  };
  const recorded: PlayersOfflineEffects = {
    record: async (_current, key, status, receipt) => {
      calls.push(
        [`record ${key} ${status}`, receipt.message ?? ""]
          .filter((part) => part !== "")
          .join(" | "),
      );
    },
    pods: async () => await readServerPod(command),
    console: command,
  };
  return { calls, effects: recorded };
}

describe("players-offline step reading the Pod from Kubernetes", () => {
  const notFound = {
    stdout: "",
    stderr: 'Error from server (NotFound): pods "minecraft-tsmc-0" not found\n',
    exitCode: 1,
  };

  const serving = {
    stdout: JSON.stringify(pod(true)),
    stderr: "",
    exitCode: 0,
  };

  test("a running server with players holds the restart", async () => {
    const run = kubernetes(
      serving,
      listed("There are 2 of a max of 20 players online: A, B\n"),
    );
    expect(await runPlayersOfflineStep(current(), KEY, run.effects)).toEqual({
      waiting: true,
    });
    expect(run.calls.at(-1)).toBe(
      `record ${KEY} running | ${KEY}: waiting for 2 player(s) to leave`,
    );
  });

  test("a running server with nobody online passes", async () => {
    const run = kubernetes(serving, EMPTY);
    expect(await runPlayersOfflineStep(current(), KEY, run.effects)).toEqual({
      waiting: false,
    });
    expect(run.calls).toContain(
      "exec -n minecraft-tsmc minecraft-tsmc-0 -c minecraft-tsmc -- rcon-cli list",
    );
  });

  test("an asleep server, its Pod absent, passes without the console", async () => {
    const run = kubernetes(notFound, EMPTY);
    expect(await runPlayersOfflineStep(current(), KEY, run.effects)).toEqual({
      waiting: false,
    });
    expect(run.calls.some((call) => call.startsWith("exec"))).toBe(false);
  });

  test("a Pod read that fails for another reason fails the step", async () => {
    const run = kubernetes(
      {
        stdout: "",
        stderr: "Error from server (Forbidden): pods is forbidden\n",
        exitCode: 1,
      },
      EMPTY,
    );
    await expect(
      runPlayersOfflineStep(current(), KEY, run.effects),
    ).rejects.toThrow("Reading minecraft-tsmc-0 failed");
  });
});

describe("parsePlayerList", () => {
  test("reads the count and maximum", () => {
    expect(
      parsePlayerList("There are 1 of a max of 20 players online: XiguaJerred"),
    ).toEqual({ online: 1, maximum: 20 });
  });

  test("refuses a count above the maximum", () => {
    expect(() =>
      parsePlayerList("There are 21 of a max of 20 players online:"),
    ).toThrow("more players than its maximum");
  });
});
