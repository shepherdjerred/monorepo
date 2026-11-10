import { describe, expect, test } from "vitest";
import {
  STREAMBOT_RECONCILE_RETRY_DELAYS_MS,
  isRefusedOrResetConnection,
  postStreambotReconcile,
  type StreambotReconcileRequest,
} from "./streambot-reconcile-request.ts";

const URL_UNDER_TEST = new URL(
  "http://streambot.test/internal/sports/reconcile",
);

function transportError(code: string): Error {
  return Object.assign(new TypeError("transport failure"), { code });
}

function harness(outcomes: (Response | Error)[]): {
  request: StreambotReconcileRequest;
  calls: RequestInit[];
  sleeps: number[];
} {
  const calls: RequestInit[] = [];
  const sleeps: number[] = [];
  const request: StreambotReconcileRequest = {
    url: URL_UNDER_TEST,
    token: "t".repeat(32),
    signal: new AbortController().signal,
    fetch: (_url, init) => {
      calls.push(init);
      const outcome = outcomes.shift();
      if (outcome === undefined) {
        throw new Error("unexpected extra fetch");
      }
      return outcome instanceof Response
        ? Promise.resolve(outcome)
        : Promise.reject(outcome);
    },
    sleep: (milliseconds) => {
      sleeps.push(milliseconds);
      return Promise.resolve();
    },
  };
  return { request, calls, sleeps };
}

describe("postStreambotReconcile", () => {
  test("retries a refused connection and returns the later response", async () => {
    const { request, calls, sleeps } = harness([
      transportError("ConnectionRefused"),
      transportError("ECONNREFUSED"),
      Response.json({ reconciled: true }),
    ]);

    const response = await postStreambotReconcile(request);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
    expect(calls[0]).toMatchObject({
      method: "POST",
      headers: { authorization: `Bearer ${"t".repeat(32)}` },
      signal: request.signal,
    });
  });

  test("retries a connection reset before any response", async () => {
    const { request, calls } = harness([
      transportError("ECONNRESET"),
      transportError("ConnectionResetByPeer"),
      Response.json({ reconciled: true }),
    ]);

    await expect(postStreambotReconcile(request)).resolves.toBeInstanceOf(
      Response,
    );
    expect(calls).toHaveLength(3);
  });

  test("gives up after the bounded retries with the transport error as cause", async () => {
    const refused = transportError("ConnectionRefused");
    const { request, calls, sleeps } = harness(
      Array.from(
        { length: STREAMBOT_RECONCILE_RETRY_DELAYS_MS.length + 1 },
        () => refused,
      ),
    );

    const failure = await postStreambotReconcile(request).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({
      message: "Streambot reconciliation could not connect after 6 attempts",
      cause: refused,
    });
    expect(calls).toHaveLength(6);
    expect(sleeps).toEqual([...STREAMBOT_RECONCILE_RETRY_DELAYS_MS]);
  });

  test("returns an HTTP error status without retrying", async () => {
    const { request, calls, sleeps } = harness([
      new Response("unavailable", { status: 503 }),
    ]);

    const response = await postStreambotReconcile(request);

    expect(response.status).toBe(503);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  test.each([
    ["a deadline timeout", new DOMException("timed out", "TimeoutError")],
    ["an abort", new DOMException("aborted", "AbortError")],
    ["a DNS failure", transportError("DNS")],
    ["an uncoded transport error", new TypeError("fetch failed")],
  ])("does not retry %s", async (_name, error) => {
    const { request, calls, sleeps } = harness([error]);

    await expect(postStreambotReconcile(request)).rejects.toBe(error);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  test("stops when the retry delay is aborted", async () => {
    const deadline = new DOMException("timed out", "TimeoutError");
    const { request, calls } = harness([transportError("ConnectionRefused")]);
    request.sleep = () => Promise.reject(deadline);

    await expect(postStreambotReconcile(request)).rejects.toBe(deadline);
    expect(calls).toHaveLength(1);
  });
});

describe("isRefusedOrResetConnection", () => {
  test("recognizes Bun's error for a refused loopback connection", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const closedUrl = `http://127.0.0.1:${String(server.port)}/`;
    await server.stop(true);

    const outcome = await fetch(closedUrl, { method: "POST" }).catch(
      (error: unknown) => error,
    );

    expect(isRefusedOrResetConnection(outcome)).toBe(true);
    expect(isRefusedOrResetConnection(new TypeError("fetch failed"))).toBe(
      false,
    );
    expect(isRefusedOrResetConnection({ code: "ECONNRESET" })).toBe(false);
  });
});
