import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod";
import {
  DeliveryApiUnavailableError,
  deliveryRequest,
  whileDeliveryApiUnavailable,
} from "./client.ts";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("DELIVERY_API_URL", "http://delivery.test:7353");
  vi.stubEnv("DELIVERY_EXECUTOR_TOKEN", "executor-token");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => Response.json(body, { status });

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the request to fail");
};

const read = () =>
  deliveryRequest("deployments/d1", z.object({ id: z.string() }));

describe("deliveryRequest classifies an unavailable API", () => {
  test("a refused connection during the API's own rollout", async () => {
    fetchMock.mockRejectedValueOnce(
      new TypeError(
        "Unable to connect. Is the computer able to access the url?",
      ),
    );
    await expect(read()).rejects.toBeInstanceOf(DeliveryApiUnavailableError);
  });

  test("a request timeout", async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
    await expect(read()).rejects.toBeInstanceOf(DeliveryApiUnavailableError);
  });

  test.each([502, 503, 504])(
    "a gateway HTTP %i without Delivery's envelope",
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        new Response("upstream gone", { status }),
      );
      await expect(read()).rejects.toBeInstanceOf(DeliveryApiUnavailableError);
    },
  );

  test("a non-JSON 500 from something in front of the API", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 500 }));
    await expect(read()).rejects.toBeInstanceOf(DeliveryApiUnavailableError);
  });
});

describe("deliveryRequest keeps every Delivery answer as it was", () => {
  test("a Delivery 500 envelope is an ordinary error", async () => {
    fetchMock.mockResolvedValueOnce(
      json(500, {
        error: { code: "INTERNAL", message: "boom", requestId: "r1" },
      }),
    );
    const error = await failure(read());
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DeliveryApiUnavailableError);
  });

  test("a paused API's 503 PAUSED stays a non-retryable refusal", async () => {
    fetchMock.mockResolvedValueOnce(
      json(503, {
        error: { code: "PAUSED", message: "writes paused", requestId: "r3" },
      }),
    );
    const error = await failure(read());
    expect(error).not.toBeInstanceOf(DeliveryApiUnavailableError);
    expect(error).toMatchObject({
      type: "DeliveryApi:PAUSED",
      nonRetryable: true,
    });
  });

  test("a 503 UNAVAILABLE, a dependency that did not answer, is retryable", async () => {
    fetchMock.mockResolvedValueOnce(
      json(503, {
        error: {
          code: "UNAVAILABLE",
          message: "The Kubernetes API did not answer",
          requestId: "r4",
        },
      }),
    );
    const error = await failure(read());
    expect(error).toBeInstanceOf(DeliveryApiUnavailableError);
    expect(error).not.toBeInstanceOf(ApplicationFailure);
  });

  test("BUSY stays non-retryable", async () => {
    fetchMock.mockResolvedValueOnce(
      json(409, {
        error: { code: "BUSY", message: "barrier", requestId: "r2" },
      }),
    );
    const error = await failure(read());
    expect(error).toBeInstanceOf(ApplicationFailure);
    expect(error).toMatchObject({
      type: "DeliveryApi:BUSY",
      nonRetryable: true,
    });
  });

  test("a non-JSON 4xx is an ordinary error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    const error = await failure(read());
    expect(error).not.toBeInstanceOf(DeliveryApiUnavailableError);
  });

  test("an unrelated thrown error propagates unchanged", async () => {
    const boom = new RangeError("bad");
    fetchMock.mockRejectedValueOnce(boom);
    await expect(read()).rejects.toBe(boom);
  });

  test("a successful read parses its body", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: "d1" }));
    await expect(read()).resolves.toEqual({ id: "d1" });
  });
});

const unavailable = () => new DeliveryApiUnavailableError("gone");
const wait = (onWait = vi.fn()) => ({ attempts: 3, intervalMs: 0, onWait });

describe("whileDeliveryApiUnavailable", () => {
  test("outlasts a short outage", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(unavailable())
      .mockRejectedValueOnce(unavailable())
      .mockResolvedValueOnce("owned");
    const onWait = vi.fn();
    await expect(
      whileDeliveryApiUnavailable(operation, wait(onWait)),
    ).resolves.toBe("owned");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(onWait.mock.calls).toEqual([[1], [2]]);
  });

  test("rethrows an outage that outlasts the wait", async () => {
    const last = unavailable();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(unavailable())
      .mockRejectedValueOnce(unavailable())
      .mockRejectedValueOnce(last);
    await expect(whileDeliveryApiUnavailable(operation, wait())).rejects.toBe(
      last,
    );
    expect(operation).toHaveBeenCalledTimes(3);
  });

  test("never repeats any other failure", async () => {
    const refusal = new Error("Deployment d1 no longer owns its environment");
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(refusal);
    await expect(whileDeliveryApiUnavailable(operation, wait())).rejects.toBe(
      refusal,
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
