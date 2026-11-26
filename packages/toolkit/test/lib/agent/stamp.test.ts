import { expect, test } from "vitest";
import { enrichActorWithHerdr } from "#lib/agent/stamp.ts";
import type { ActorEnvelope } from "@shepherdjerred/tracker/contract";

const actor: ActorEnvelope = {
  key: "muse:session-1",
  kind: "agent",
  name: "muse",
  metadata: { harness: "muse", sessionId: "session-1", hcTerminal: "t9" },
};

test("stamps hcAddress and Herdr space/tab from hc get labels", async () => {
  const enriched = await enrichActorWithHerdr(
    actor,
    { HC_TERMINAL_ID: "t9" },
    (args) => {
      expect(args).toEqual(["hc", "get", "t9", "--json"]);
      return Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify({
          address: "t9",
          labels: { "herdr.space": "sp1", "herdr.tab": "tb1" },
          status: { app: "muse", state: "working" },
        }),
        stderr: "",
      });
    },
  );
  expect(enriched.metadata).toMatchObject({
    hcTerminal: "t9",
    hcAddress: "t9",
    herdrSpace: "sp1",
    herdrTab: "tb1",
  });
});

test("leaves the actor unchanged when hc is unavailable or errors", async () => {
  const failing = await enrichActorWithHerdr(
    actor,
    { HC_TERMINAL_ID: "t9" },
    () => Promise.resolve({ exitCode: 1, stdout: "", stderr: "no core" }),
  );
  expect(failing).toEqual(actor);
  const throwing = await enrichActorWithHerdr(
    actor,
    { HC_TERMINAL_ID: "t9" },
    () => Promise.reject(new Error("spawn failed")),
  );
  expect(throwing).toEqual(actor);
  const noTerminal = await enrichActorWithHerdr(actor, {}, () =>
    Promise.reject(new Error("must not be called")),
  );
  expect(noTerminal).toEqual(actor);
});
