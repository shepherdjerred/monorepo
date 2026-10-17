import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  awaitNativeCandidate,
  candidateReady,
  retainNativeCombatFailure,
} from "./native-readiness.ts";

it("requires an actual JSON boolean from the candidate completion fixture", () => {
  expect(candidateReady("false")).toBe(false);
  expect(candidateReady("true")).toBe(true);
  for (const reply of [
    '"false"',
    '"true"',
    "1",
    "null",
    "{}",
    "[]",
    "Ready: true, phase: Lobby",
  ]) {
    expect(() => candidateReady(reply)).toThrow();
  }
});

const match = "00000000-0000-4000-8000-000000000001";
const journal = {
  schema: 1,
  kind: "rwf-capacity-combat",
  match,
  startedTick: 1,
  sampledTick: 2,
  human: "00000000-0000-4000-8000-000000000002",
  bots: ["00000000-0000-4000-8000-000000000003"],
  dropped: 0,
  pending: 0,
  hits: [],
};

it("retains a timestamped passive sample bound to the armed match, without inferring a death", async () => {
  const artifacts = await mkdtemp(
    path.join(tmpdir(), "native-combat-evidence-"),
  );
  const commands: string[] = [];
  const reply = JSON.stringify(journal);
  try {
    await retainNativeCombatFailure(
      {
        command(command) {
          commands.push(command);
          return Promise.resolve(reply);
        },
      },
      artifacts,
      match,
    );
    expect(commands).toEqual(["rwfcapacitycombat sample"]);
    expect(
      await Bun.file(path.join(artifacts, "combat-failure.json")).json(),
    ).toEqual({
      command: "rwfcapacitycombat sample",
      match,
      reply,
      capture: journal,
      requestedAt: expect.any(Number),
      receivedAt: expect.any(Number),
    });
  } finally {
    await rm(artifacts, { recursive: true });
  }
});

it.each(["not JSON", JSON.stringify({ ...journal, match: journal.human })])(
  "retains an invalid or foreign raw sample without replacing the original failure: %s",
  async (reply) => {
    const artifacts = await mkdtemp(
      path.join(tmpdir(), "native-combat-evidence-"),
    );
    try {
      await expect(
        retainNativeCombatFailure(
          { command: () => Promise.resolve(reply) },
          artifacts,
          match,
        ),
      ).resolves.toBeUndefined();
      const retained: unknown = await Bun.file(
        path.join(artifacts, "combat-failure.json"),
      ).json();
      expect(retained).toEqual({
        command: "rwfcapacitycombat sample",
        match,
        reply,
        requestedAt: expect.any(Number),
        receivedAt: expect.any(Number),
        captureFailure: expect.any(String),
      });
    } finally {
      await rm(artifacts, { recursive: true });
    }
  },
);

it("retains a transport failure without replacing the original acceptance error", async () => {
  const artifacts = await mkdtemp(
    path.join(tmpdir(), "native-combat-evidence-"),
  );
  try {
    await expect(
      retainNativeCombatFailure(
        { command: () => Promise.reject(new Error("synthetic closed RCON")) },
        artifacts,
        match,
      ),
    ).resolves.toBeUndefined();
    const retained: unknown = await Bun.file(
      path.join(artifacts, "combat-failure.json"),
    ).json();
    expect(retained).toEqual({
      command: "rwfcapacitycombat sample",
      match,
      requestedAt: expect.any(Number),
      captureFailure: "Error: synthetic closed RCON",
    });
  } finally {
    await rm(artifacts, { recursive: true });
  }
});

it("does not replace the original failure when passive evidence cannot be written", async () => {
  const artifacts = await mkdtemp(
    path.join(tmpdir(), "native-combat-evidence-"),
  );
  const file = path.join(artifacts, "not-a-directory");
  try {
    await Bun.write(file, "fixture");
    await expect(
      retainNativeCombatFailure(
        { command: () => Promise.resolve(JSON.stringify(journal)) },
        file,
        match,
      ),
    ).resolves.toBeUndefined();
  } finally {
    await rm(artifacts, { recursive: true });
  }
});

it("waits past general Lobby readiness until the exact candidate completes, retaining both replies", async () => {
  const commands: string[] = [];
  let candidates = 0;
  const result = await awaitNativeCandidate(
    {
      command(command: string) {
        commands.push(command);
        if (command === "rwf admin status")
          return Promise.resolve("Ready: true, phase: Lobby");
        candidates += 1;
        return Promise.resolve(candidates === 2 ? "true" : "false");
      },
    },
    "apex-expanse",
  );
  try {
    expect(commands).toEqual([
      "rwf admin status",
      "storm-fixture-map-lifecycle candidate-ready apex-expanse",
      "rwf admin status",
      "storm-fixture-map-lifecycle candidate-ready apex-expanse",
    ]);
    const retained = await readFile(result.preparation.replies, "utf8");
    const replies = retained
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
    expect(replies).toEqual(
      commands.map((command, i) => ({
        requestedAt: expect.any(Number),
        receivedAt: expect.any(Number),
        command,
        reply:
          i % 2 === 0
            ? "Ready: true, phase: Lobby"
            : i === 1
              ? "false"
              : "true",
      })),
    );
    expect(result.preparation.readyAt).toBeGreaterThanOrEqual(
      result.preparation.startedAt,
    );
    expect(result.preparation.method).toBe(commands[1]);
  } finally {
    await rm(path.dirname(result.preparation.replies), { recursive: true });
  }
});
