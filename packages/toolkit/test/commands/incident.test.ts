import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import type { ActorInput } from "@shepherdjerred/incidents/contract";
import type { IncidentCommandContext } from "#commands/incident/record.ts";
import {
  IncidentUsageError,
  parseIncidentArgs,
  parseLink,
  suspectOf,
  systemsOf,
} from "#commands/incident/options.ts";
import { executeIncidentCommand } from "#handlers/incident/index.ts";
import { incidentStream } from "#lib/incidents/stream.ts";
import {
  agentActor,
  fakeSpawns,
  REPO,
  startTestHub,
  type TestHub,
} from "#test/lib/incidents/harness.ts";

const hubs: TestHub[] = [];
afterEach(async () => {
  for (const hub of hubs.splice(0)) await hub.hub.stop();
});

async function hubFor(): Promise<TestHub> {
  const hub = await startTestHub();
  hubs.push(hub);
  return hub;
}

function contextFor(
  hub: TestHub,
  actor: ActorInput | null,
  spawns = fakeSpawns(),
  signal?: AbortSignal,
): IncidentCommandContext {
  return {
    url: hub.hub.url,
    api: hub.api,
    actor: () =>
      actor === null
        ? Promise.reject(new Error("no session identity"))
        : Promise.resolve(actor),
    stream: incidentStream(hub.hub.url),
    scheduler: hub.scheduler,
    spawner: spawns.spawnerFor(actor?.key ?? "anonymous"),
    spawnerName: "fake-spawner",
    repo: () => REPO,
    handles: hub.handles,
    hubUrl: hub.hub.url,
    log: (line) => {
      hub.logs.push(line);
    },
    signal,
  };
}

function run(
  hub: TestHub,
  actor: ActorInput | null,
  command: string,
  runtime: {
    spawns?: ReturnType<typeof fakeSpawns>;
    signal?: AbortSignal;
  } = {},
) {
  const { spawns = fakeSpawns(), signal } = runtime;
  const [action = "", ...args] = command.split(" ");
  const lines: string[] = [];
  return executeIncidentCommand(
    (_options, given) => Promise.resolve(contextFor(hub, actor, spawns, given)),
    action,
    args,
    { emit: (line) => lines.push(line), signal },
  );
}

/** Commands with quoted values, split the way a shell would. */
function runArgs(
  hub: TestHub,
  actor: ActorInput | null,
  args: string[],
  spawns = fakeSpawns(),
) {
  const [action = "", ...rest] = args;
  const lines: string[] = [];
  return executeIncidentCommand(
    () => Promise.resolve(contextFor(hub, actor, spawns)),
    action,
    rest,
    { emit: (line) => lines.push(line) },
  );
}

function identifierOf(outcome: { json: unknown }): string {
  return z.object({ identifier: z.string() }).parse(outcome.json).identifier;
}

function revisionOfResult(outcome: { json: unknown }): number {
  return z.object({ revision: z.number() }).parse(outcome.json).revision;
}

const DECLARE = [
  "declare",
  "--title",
  "Storage is read-only",
  "--system",
  "storage",
  "--severity",
  "sev2",
  "--exit-condition",
  "Writes to the storage pool succeed again.",
];

describe("argument parsing", () => {
  test("--link takes kind=ref[,url] and validates the kind", () => {
    expect(parseLink("pr=5144,https://github.com/o/r/pull/5144")).toEqual({
      kind: "pr",
      ref: "5144",
      url: "https://github.com/o/r/pull/5144",
    });
    expect(parseLink("tracker-issue=AI-12")).toEqual({
      kind: "tracker-issue",
      ref: "AI-12",
    });
    expect(() => parseLink("5144")).toThrow(IncidentUsageError);
    expect(() => parseLink("nope=1")).toThrow(/--link nope=1: kind/u);
  });

  test("systems are repeatable or comma-separated and closed", () => {
    const { values } = parseIncidentArgs([
      "--system",
      "delivery,main-ci",
      "--system",
      "hub",
    ]);
    expect(systemsOf(values)).toEqual(["delivery", "main-ci", "hub"]);
    expect(() =>
      systemsOf(parseIncidentArgs(["--system", "kubernetes"]).values),
    ).toThrow(/Unknown system kubernetes/u);
  });

  test("suspect flags build the contract shape", () => {
    expect(
      suspectOf(
        parseIncidentArgs([
          "--suspect-pr",
          "5150",
          "--suspect-commit",
          "ABCDEF1",
          "--suspect-branch",
          "x",
        ]).values,
      ),
    ).toEqual({ prNumber: 5150, commitSha: "abcdef1", branch: "x" });
    expect(() =>
      suspectOf(parseIncidentArgs(["--suspect-commit", "xyz"]).values),
    ).toThrow(IncidentUsageError);
  });

  test("usage errors exit 2 before any request", async () => {
    const hub = await hubFor();
    const actor = agentActor("a");
    for (const command of [
      "frobnicate",
      "view",
      "declare --title x",
      "status INC-1 monitoring",
      "resolve INC-1 --note done",
      "wait",
      "wait INC-1 --system delivery",
      "watch --until-resolved",
      "list --bogus",
    ]) {
      const outcome = await run(hub, actor, command);
      expect([command, outcome.exitCode]).toEqual([command, 2]);
      expect(outcome.json).toMatchObject({ error: { code: "USAGE" } });
    }
  });
});

describe("commands against the fixture Hub", () => {
  test("check exits 10 with the relation and next command when something blocks", async () => {
    const hub = await hubFor();
    const outcome = await run(
      hub,
      agentActor("blocked"),
      "check --system delivery --json",
    );

    expect(outcome.exitCode).toBe(10);
    expect(outcome.json).toMatchObject({
      incidents: [
        {
          incident: {
            systems: ["delivery"],
            command: { state: "dispatching" },
          },
          relation: { commander: false, suspect: false, affected: false },
          next: expect.stringMatching(/^toolkit incident wait INC-\d+$/u),
        },
      ],
      recommended: expect.stringContaining("toolkit incident wait INC-"),
      exitCode: 10,
    });
  });

  test("check exits 0 with the declare command when nothing is open", async () => {
    const hub = await hubFor();
    const outcome = await run(hub, null, "check --system network");

    expect(outcome.exitCode).toBe(0);
    expect(outcome.text).toContain(
      "Nothing open for network — if network is broken, declare it: toolkit incident declare --system network",
    );
    expect(outcome.text).toContain("No session identity");
  });

  test("check exits 11 for the suspect of an unowned incident", async () => {
    const hub = await hubFor();
    await runArgs(hub, agentActor("declarer"), [
      ...DECLARE,
      "--suspect-branch",
      "broke-it",
    ]);
    const outcome = await run(
      hub,
      agentActor("x", { branch: "broke-it" }),
      "check --system storage",
    );

    expect(outcome.exitCode).toBe(11);
    expect(outcome.text).toMatch(
      /Next: You likely caused INC-\d+ — take it: toolkit incident take INC-\d+/u,
    );
  });

  test("declare, then a duplicate names the open incident and how to wait on it", async () => {
    const hub = await hubFor();
    const declared = await runArgs(hub, agentActor("declarer"), [
      ...DECLARE,
      "--link",
      "pr=5150,https://github.com/o/r/pull/5150",
      "--component",
      "seaweedfs",
      "--json",
    ]);
    expect(declared.exitCode).toBe(0);
    expect(declared.json).toMatchObject({
      identifier: expect.stringMatching(/^INC-\d+$/u),
      systems: ["storage"],
      components: ["seaweedfs"],
      links: [{ kind: "pr", ref: "5150" }],
    });

    const duplicate = await runArgs(hub, agentActor("other"), DECLARE);
    const id = identifierOf(declared);
    expect(duplicate.exitCode).toBe(13);
    expect(duplicate.text).toContain(`${id} is already open for storage`);
    expect(duplicate.text).toContain(`toolkit incident wait ${id}`);
    expect(duplicate.text).toContain(`toolkit incident join ${id}`);
  });

  test("a stale --expected-revision exits 14 with the current revision", async () => {
    const hub = await hubFor();
    const declared = await runArgs(hub, agentActor("declarer"), [
      ...DECLARE,
      "--take",
    ]);
    const id = identifierOf(declared);
    await run(hub, agentActor("declarer"), `update ${id} --body progress`);

    const outcome = await run(
      hub,
      agentActor("declarer"),
      `status ${id} monitoring --expected-revision 0`,
    );

    expect(outcome.exitCode).toBe(14);
    expect(outcome.text).toMatch(
      new RegExp(String.raw`${id} is at revision \d+, not 0`, "u"),
    );
  });
});

describe("command claims against the fixture Hub", () => {
  test("take reports outcomes; take --spawn never prints the dispatch token", async () => {
    const hub = await hubFor();
    const declared = await runArgs(hub, agentActor("declarer"), DECLARE);
    const id = identifierOf(declared);

    const early = await run(hub, agentActor("a"), `take ${id}`);
    expect(early.exitCode).toBe(15);
    expect(early.text).toContain("takeover grace has not passed");

    const spawns = fakeSpawns();
    const spawned = await run(
      hub,
      agentActor("a"),
      `take ${id} --spawn --force --json`,
      { spawns },
    );
    expect(spawned.exitCode).toBe(0);
    expect(spawns.calls).toHaveLength(1);
    const call = spawns.calls[0];
    const token = hub.tokenOf(call);
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect(JSON.stringify(call?.request)).not.toContain(token);
    expect(spawned.json).toMatchObject({
      take: { outcome: "dispatching", dispatchToken: "[redacted]" },
      dispatch: { outcome: "spawned", provider: "claude-code" },
    });
    expect(JSON.stringify(spawned.json)).not.toContain(token);

    const claimed = await run(
      hub,
      agentActor("commander"),
      `claim ${id} --dispatch-handle ${call?.handle ?? ""} --json`,
    );
    expect(claimed.exitCode).toBe(0);
    // The handle is single-use: the token is gone once redeemed.
    expect(hub.tokens.size).toBe(0);
    const again = await run(
      hub,
      agentActor("commander"),
      `claim ${id} --dispatch-handle ${call?.handle ?? ""}`,
    );
    expect(again.exitCode).toBe(15);
    expect(again.text).toContain("No dispatch handle");
    expect(claimed.json).toMatchObject({
      command: { state: "owned", commander: { key: "claude-code:commander" } },
    });
    expect(JSON.stringify(claimed.json)).not.toContain(token);

    const view = await run(hub, null, `view ${id} --json`);
    const resolve = await runArgs(hub, agentActor("commander"), [
      "resolve",
      id,
      "--expected-revision",
      String(revisionOfResult(view)),
      "--note",
      "Writes succeed again.",
    ]);
    expect(resolve.exitCode).toBe(0);
    expect(resolve.text).toContain("resolved");
  });

  test("a failed take --spawn releases the lease and exits 1", async () => {
    const hub = await hubFor();
    const declared = await runArgs(hub, agentActor("declarer"), DECLARE);
    const id = identifierOf(declared);
    const spawns = fakeSpawns([{ ok: false, error: "no herdr" }]);

    const outcome = await run(
      hub,
      agentActor("a"),
      `take ${id} --spawn --force`,
      { spawns },
    );

    expect(outcome.exitCode).toBe(1);
    expect(outcome.text).toBe(
      "Spawn failed and the lease was released: no herdr",
    );
    const detail = await hub.api.byRef(id);
    expect(detail.command.state).toBe("none");
    expect(hub.tokens.size).toBe(0);
  });

  test("a refused claim discards its handle; a malformed handle is a usage error", async () => {
    const hub = await hubFor();
    const declared = await runArgs(hub, agentActor("declarer"), DECLARE);
    const id = identifierOf(declared);
    const handle = await hub.handles.save("x".repeat(24));

    const refused = await run(
      hub,
      agentActor("commander"),
      `claim ${id} --dispatch-handle ${handle}`,
    );
    expect(refused.exitCode).not.toBe(0);
    expect(hub.tokens.has(handle)).toBe(false);

    const malformed = await run(
      hub,
      agentActor("commander"),
      `claim ${id} --dispatch-handle ../../etc/passwd`,
    );
    expect(malformed.exitCode).toBe(2);
  });

  test.each(["watch", "watch INC --until-resolved"])(
    "%s interrupted before it registers its listener exits as canceled",
    async (command) => {
      const hub = await hubFor();
      const declared = await runArgs(hub, agentActor("declarer"), DECLARE);
      const controller = new AbortController();
      controller.abort();

      const outcome = await run(
        hub,
        null,
        command.replace("INC", identifierOf(declared)),
        { signal: controller.signal },
      );

      expect(outcome.exitCode).toBe(130);
      expect(outcome.json).toEqual({ outcome: "canceled" });
    },
  );

  test("update defaults to the current revision; link, join, leave, handoff and release work", async () => {
    const hub = await hubFor();
    const me = agentActor("declarer");
    const declared = await runArgs(hub, me, [...DECLARE, "--take"]);
    const id = identifierOf(declared);

    await expect(
      runArgs(hub, me, ["update", id, "--body", "Remounting the pool"]),
    ).resolves.toMatchObject({ exitCode: 0 });
    await expect(
      runArgs(hub, me, [
        "link",
        id,
        "--kind",
        "pipeline",
        "--ref",
        "19260",
        "--title",
        "red run",
      ]),
    ).resolves.toMatchObject({ exitCode: 0 });
    await expect(
      run(hub, agentActor("b"), `join ${id}`),
    ).resolves.toMatchObject({ exitCode: 0 });
    await expect(
      run(hub, agentActor("b"), `leave ${id}`),
    ).resolves.toMatchObject({ exitCode: 0 });
    await expect(
      run(hub, me, `handoff ${id} --to claude-code:b`),
    ).resolves.toMatchObject({ exitCode: 0 });
    await expect(
      run(hub, agentActor("b"), `release ${id}`),
    ).resolves.toMatchObject({ exitCode: 0 });

    const detail = await hub.api.byRef(id);
    expect(detail.command.state).toBe("none");
    expect(detail.links).toEqual([
      expect.objectContaining({
        kind: "pipeline",
        ref: "19260",
        title: "red run",
      }),
    ]);
    expect(detail.timeline.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "update",
        "link-added",
        "joined",
        "left",
        "handed-off",
        "released",
      ]),
    );
  });

  test("list and view print text and JSON", async () => {
    const hub = await hubFor();
    const listed = await run(hub, null, "list --state all --json");
    expect(listed.exitCode).toBe(0);
    expect(Array.isArray(listed.json)).toBe(true);
    const text = await run(hub, null, "list");
    expect(text.text).toMatch(/^INC-\d+ sev1 investigating \[delivery\]/mu);
  });

  test("an unreachable Hub exits 1", async () => {
    const hub = await hubFor();
    await hub.hub.stop();
    const outcome = await run(hub, null, "list");
    expect(outcome.exitCode).toBe(1);
    expect(outcome.text).toMatch(/^Incidents request failed/u);
  });
});
