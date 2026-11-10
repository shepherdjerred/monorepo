import { beforeAll, describe, expect, test } from "vitest";
import { Connection, ServiceError } from "@temporalio/client";
import { NativeConnection } from "@temporalio/worker";
import { STARTUP_RETRY_ESCALATION_ATTEMPT } from "#shared/startup-retry.ts";
import {
  connectTemporalWhenReady,
  isTemporalUnavailableError,
} from "./temporal-startup-connection.ts";

// Nothing listens on port 1, so both SDK connections fail the way they do
// during a Temporal server outage.
const UNREACHABLE_ADDRESS = "127.0.0.1:1";

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the connection attempt to fail");
}

let nativeRefused: unknown;
let clientDeadline: unknown;

beforeAll(async () => {
  nativeRefused = await rejection(
    NativeConnection.connect({ address: UNREACHABLE_ADDRESS }),
  );
  clientDeadline = await rejection(
    Connection.connect({ address: UNREACHABLE_ADDRESS, connectTimeout: 200 }),
  );
});

function grpcServiceError(code: number): ServiceError {
  return new ServiceError("Failed to connect to Temporal server", {
    cause: Object.assign(new Error("grpc"), {
      code,
      details: "",
      metadata: { get: () => [] },
    }),
  });
}

describe("isTemporalUnavailableError", () => {
  test("retries the native worker connection's transport failure", () => {
    expect(nativeRefused).toMatchObject({ name: "TransportError" });
    expect(isTemporalUnavailableError(nativeRefused)).toBe(true);
  });

  test("retries the client connection's ready deadline", () => {
    expect(isTemporalUnavailableError(clientDeadline)).toBe(true);
  });

  test.each([
    ["UNAVAILABLE system info reply", grpcServiceError(14)],
    ["DEADLINE_EXCEEDED system info reply", grpcServiceError(4)],
  ])("retries a %s", (_name, error) => {
    expect(isTemporalUnavailableError(error)).toBe(true);
  });

  test.each([
    ["UNAUTHENTICATED system info reply", grpcServiceError(16)],
    ["unrelated error", new Error("Namespace prod is not found")],
    ["non-error value", "Failed to connect before the deadline"],
  ])("keeps a %s fatal", (_name, error) => {
    expect(isTemporalUnavailableError(error)).toBe(false);
  });
});

describe("connectTemporalWhenReady", () => {
  test("waits out an outage, escalates once, and returns the connection", async () => {
    const failures = STARTUP_RETRY_ESCALATION_ATTEMPT + 2;
    let calls = 0;
    const delays: number[] = [];
    const escalations: string[] = [];

    const connection = await connectTemporalWhenReady({
      target: "worker",
      address: "temporal:7233",
      connect: async () => {
        calls += 1;
        if (calls <= failures) throw nativeRefused;
        return { id: "connected" };
      },
      random: () => 0,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
      escalate: (message) => {
        escalations.push(message);
      },
    });

    expect(connection).toEqual({ id: "connected" });
    expect(calls).toBe(failures + 1);
    expect(delays).toHaveLength(failures);
    expect(delays.slice(0, 3)).toEqual([5000, 10_000, 20_000]);
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toContain(
      `Temporal worker connection to temporal:7233 has failed ${String(STARTUP_RETRY_ESCALATION_ATTEMPT)} consecutive times`,
    );
  });

  test("rethrows a non-transport failure without retrying", async () => {
    let calls = 0;
    const fatal = new Error("Namespace prod is not found");
    await expect(
      connectTemporalWhenReady({
        target: "client",
        address: "temporal:7233",
        connect: async () => {
          calls += 1;
          throw fatal;
        },
        sleep: async () => {
          throw new Error("must not sleep");
        },
        escalate: () => {
          throw new Error("must not escalate");
        },
      }),
    ).rejects.toBe(fatal);
    expect(calls).toBe(1);
  });
});
