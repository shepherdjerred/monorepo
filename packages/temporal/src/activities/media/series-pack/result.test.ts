import { ServiceError } from "@temporalio/client";
import { expect, test } from "vitest";
import { boundedPollExpired } from "./result.ts";

// Standard gRPC status codes.
const status = { CANCELLED: 1, DEADLINE_EXCEEDED: 4, UNAVAILABLE: 14 } as const;

function grpcFailure(code: number): ServiceError {
  const cause = Object.assign(new Error(`gRPC status ${String(code)}`), {
    code,
    details: "grpc failure",
    metadata: {},
  });
  return new ServiceError("Failed to get Workflow execution history", {
    cause,
  });
}

const pollDeadline = 1_000_000;

test("client-side deadline expiry ends the bounded long-poll", () => {
  expect(
    boundedPollExpired(
      grpcFailure(status.DEADLINE_EXCEEDED),
      pollDeadline,
      pollDeadline - 1,
    ),
  ).toBe(true);
});

test("a server deadline reset that reaches the client first also ends it", () => {
  expect(
    boundedPollExpired(
      grpcFailure(status.CANCELLED),
      pollDeadline,
      pollDeadline,
    ),
  ).toBe(true);
});

test("a cancellation before the window elapses is a real failure", () => {
  expect(
    boundedPollExpired(
      grpcFailure(status.CANCELLED),
      pollDeadline,
      pollDeadline - 1,
    ),
  ).toBe(false);
});

test("other failures are never treated as poll expiry", () => {
  expect(
    boundedPollExpired(
      grpcFailure(status.UNAVAILABLE),
      pollDeadline,
      pollDeadline + 1,
    ),
  ).toBe(false);
  expect(
    boundedPollExpired(new Error("plain"), pollDeadline, pollDeadline + 1),
  ).toBe(false);
});
