import { describe, expect, test } from "vitest";
import { createRetryingDeliveryFetch } from "./retry-fetch.ts";

describe("createRetryingDeliveryFetch", () => {
  test("creates a callable fetch wrapper with default options", () => {
    const retryingFetch = createRetryingDeliveryFetch();
    expect(typeof retryingFetch).toBe("function");
  });

  test("retries transient 503 PAUSED responses with default sleep and returns 200", async () => {
    let calls = 0;
    const retryingFetch = createRetryingDeliveryFetch({
      delaysMs: [1],
      fetch: () => {
        calls += 1;
        return calls === 1
          ? Promise.resolve(new Response('{"code":"PAUSED"}', { status: 503 }))
          : Promise.resolve(new Response('{"ok":true}', { status: 200 }));
      },
    });

    const response = await retryingFetch("https://delivery.example.test/api");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
    expect(calls).toBe(2);
  });

  test("retries 500/502/504 across configured backoff steps and returns final response on exhaustion", async () => {
    const statuses = [500, 502, 504];
    const sleptMs: number[] = [];
    let index = 0;
    const retryingFetch = createRetryingDeliveryFetch({
      delaysMs: [10, 25],
      sleep: (ms) => {
        sleptMs.push(ms);
        return Promise.resolve();
      },
      fetch: () => {
        const status = statuses[index] ?? 504;
        index += 1;
        return Promise.resolve(new Response(null, { status }));
      },
    });

    const response = await retryingFetch("https://delivery.example.test/api", {
      method: "POST",
    });
    expect(response.status).toBe(504);
    expect(sleptMs).toEqual([10, 25]);
    expect(index).toBe(3);
  });

  test("does not retry 4xx client responses", async () => {
    const sleptMs: number[] = [];
    let calls = 0;
    const retryingFetch = createRetryingDeliveryFetch({
      delaysMs: [10, 20],
      sleep: (ms) => {
        sleptMs.push(ms);
        return Promise.resolve();
      },
      fetch: () => {
        calls += 1;
        return Promise.resolve(new Response("bad request", { status: 400 }));
      },
    });

    const response = await retryingFetch("https://delivery.example.test/api");
    expect(response.status).toBe(400);
    expect(calls).toBe(1);
    expect(sleptMs).toEqual([]);
  });

  test("retries transport errors and rethrows when backoff steps are exhausted", async () => {
    const sleptMs: number[] = [];
    let calls = 0;
    const recoverFetch = createRetryingDeliveryFetch({
      delaysMs: [5, 15],
      sleep: (ms) => {
        sleptMs.push(ms);
        return Promise.resolve();
      },
      fetch: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("ECONNRESET"))
          : Promise.resolve(new Response("recovered", { status: 200 }));
      },
    });

    const recovered = await recoverFetch("https://delivery.example.test/api");
    expect(recovered.status).toBe(200);
    expect(sleptMs).toEqual([5]);

    const exhaustedSleeps: number[] = [];
    const failingFetch = createRetryingDeliveryFetch({
      delaysMs: [7],
      sleep: (ms) => {
        exhaustedSleeps.push(ms);
        return Promise.resolve();
      },
      fetch: () => Promise.reject(new Error("connect ETIMEDOUT")),
    });

    await expect(
      failingFetch("https://delivery.example.test/api"),
    ).rejects.toThrow("connect ETIMEDOUT");
    expect(exhaustedSleeps).toEqual([7]);
  });
});
