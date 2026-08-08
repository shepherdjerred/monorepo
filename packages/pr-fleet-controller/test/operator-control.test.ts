import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startOperatorControlServer } from "@shepherdjerred/pr-fleet-controller/src/operator-control.ts";
import { secureRunArtifactFiles } from "@shepherdjerred/pr-fleet-controller/src/run-artifacts.ts";
import type {
  FleetSnapshot,
  OperatorInputAnswer,
} from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import { startWatchServer } from "@shepherdjerred/pr-fleet-controller/src/watch-server.ts";

const snapshot: FleetSnapshot = {
  open: 0,
  green: 0,
  active: 0,
  queued: 0,
  pending: 0,
  waiting: 0,
  paused: 0,
  prs: [],
};

const answer: OperatorInputAnswer = {
  requestId: "request-1",
  answers: [
    {
      questionId: "ownership",
      optionId: "include",
      freeText: null,
    },
  ],
};

const cleanup: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) {
    await stop();
  }
});

async function postAnswer(
  serverUrl: string,
  body: OperatorInputAnswer,
  origin = new URL(serverUrl).origin,
): Promise<Response> {
  return fetch(
    new URL(
      `/api/operator-requests/${encodeURIComponent(body.requestId)}/answer`,
      serverUrl,
    ),
    {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    },
  );
}

describe("dashboard operator answer forwarding", () => {
  test("forwards a same-origin answer over a mode-0600 Unix socket", async () => {
    const runDirectory = await mkdtemp(
      path.join(tmpdir(), "pr-fleet-control-"),
    );
    cleanup.push(() => rm(runDirectory, { recursive: true, force: true }));
    const received: OperatorInputAnswer[] = [];
    const control = await startOperatorControlServer({
      socketPath: path.join(runDirectory, "control.sock"),
      answer: (input) => {
        received.push(input);
        return Promise.resolve({
          trigger: "user",
          snapshot,
          changes: ["answer accepted"],
          nextHeartbeatSeconds: 300,
        });
      },
    });
    cleanup.push(() => control.stop());
    const socketStats = await stat(control.socketPath);
    expect(socketStats.mode & 0o777).toBe(0o600);
    await expect(secureRunArtifactFiles(runDirectory)).resolves.toBeUndefined();
    const watch = startWatchServer({
      runDirectory,
      controlSocket: control.socketPath,
    });
    cleanup.push(() => watch.stop());

    const response = await postAnswer(watch.url, answer);
    expect(response.status).toBe(200);
    expect(received).toEqual([answer]);
  });

  test("rejects cross-origin, historical, and unavailable-controller answers", async () => {
    const runDirectory = await mkdtemp(
      path.join(tmpdir(), "pr-fleet-control-"),
    );
    cleanup.push(() => rm(runDirectory, { recursive: true, force: true }));

    const historical = startWatchServer({ runDirectory });
    cleanup.push(() => historical.stop());
    const historicalResponse = await postAnswer(historical.url, answer);
    expect(historicalResponse.status).toBe(409);

    const unavailable = startWatchServer({
      runDirectory,
      controlSocket: path.join(runDirectory, "missing.sock"),
    });
    cleanup.push(() => unavailable.stop());
    const unavailableResponse = await postAnswer(unavailable.url, answer);
    expect(unavailableResponse.status).toBe(400);
    const crossOriginResponse = await postAnswer(
      unavailable.url,
      answer,
      "http://example.invalid",
    );
    expect(crossOriginResponse.status).toBe(403);
  });

  test("rejects invalid, duplicate, and stale answers", async () => {
    const runDirectory = await mkdtemp(
      path.join(tmpdir(), "pr-fleet-control-"),
    );
    cleanup.push(() => rm(runDirectory, { recursive: true, force: true }));
    const acceptedRequests = new Set<string>();
    let callbackCount = 0;
    const control = await startOperatorControlServer({
      socketPath: path.join(runDirectory, "control.sock"),
      answer: (input) => {
        callbackCount += 1;
        if (input.requestId === "stale-request") {
          throw new Error("Operator request belongs to a stale PR head");
        }
        if (acceptedRequests.has(input.requestId)) {
          throw new Error("Operator request was already answered");
        }
        acceptedRequests.add(input.requestId);
        return Promise.resolve({
          trigger: "user",
          snapshot,
          changes: ["answer accepted"],
          nextHeartbeatSeconds: 300,
        });
      },
    });
    cleanup.push(() => control.stop());
    const watch = startWatchServer({
      runDirectory,
      controlSocket: control.socketPath,
    });
    cleanup.push(() => watch.stop());

    const invalidResponse = await fetch(
      new URL("/api/operator-requests/request-1/answer", watch.url),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: new URL(watch.url).origin,
        },
        body: JSON.stringify({ requestId: "request-1", answers: [] }),
      },
    );
    expect(invalidResponse.status).toBe(400);
    expect(callbackCount).toBe(0);

    const acceptedResponse = await postAnswer(watch.url, answer);
    expect(acceptedResponse.status).toBe(200);
    const duplicateResponse = await postAnswer(watch.url, answer);
    expect(duplicateResponse.status).toBe(400);

    const staleAnswer: OperatorInputAnswer = {
      ...answer,
      requestId: "stale-request",
    };
    const staleResponse = await postAnswer(watch.url, staleAnswer);
    expect(staleResponse.status).toBe(400);
    expect(callbackCount).toBe(3);
  });
});
