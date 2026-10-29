import { afterEach, expect, test, vi } from "vitest";
import {
  capturePublicationExecution,
  publicationDeadline,
} from "./invocation.ts";

afterEach(() => vi.restoreAllMocks());

function fixture(sdkDuration = 300_000) {
  const wall = 1_900_000_000_000;
  const monotonic = 1000;
  const clock = vi.spyOn(Date, "now").mockReturnValue(wall);
  const elapsed = vi.spyOn(performance, "now").mockReturnValue(monotonic);
  const controller = new AbortController();
  const assertActive = vi.fn(() => controller.signal.throwIfAborted());
  const checkpoint = vi.fn(() => Promise.resolve());
  const execution = capturePublicationExecution(
    () => ({
      expiresAtMs: wall + sdkDuration,
      signal: controller.signal,
      assertActive,
      checkpoint,
    }),
    "publication",
  );
  return {
    wall,
    monotonic,
    clock,
    elapsed,
    controller,
    assertActive,
    checkpoint,
    execution,
  };
}

test("authority after earlier awaits retains entry plus sixty seconds, not the later root deadline", () => {
  const f = fixture();
  f.clock.mockReturnValue(f.wall + 45_000);
  f.elapsed.mockReturnValue(f.monotonic + 45_000);
  const authority = publicationDeadline(f.execution, f.wall + 120_000);
  expect(authority.expiresAtMs).toBe(f.wall + 60_000);
  expect(() => authority.assertActive()).not.toThrow();
  f.clock.mockReturnValue(f.wall + 60_000);
  f.elapsed.mockReturnValue(f.monotonic + 60_000);
  expect(() => authority.assertActive()).toThrow(
    "publication_authority_expired",
  );
  expect(() => publicationDeadline(f.execution, f.wall + 180_000)).toThrow(
    "publication_authority_expired",
  );
});

test("a shorter original SDK deadline survives a late authority read and monotonic expiry", () => {
  const f = fixture(25_000);
  f.clock.mockReturnValue(f.wall + 20_000);
  f.elapsed.mockReturnValue(f.monotonic + 20_000);
  const authority = publicationDeadline(f.execution, f.wall + 120_000);
  expect(authority.expiresAtMs).toBe(f.execution.expiresAtMs);
  f.elapsed.mockReturnValue(f.monotonic + 25_000);
  expect(() => authority.assertActive()).toThrow(
    "publication_authority_expired",
  );
});

test("a shorter storage or lease expiry remains the final bound", () => {
  const f = fixture();
  const authority = publicationDeadline(f.execution, f.wall + 15_000);
  expect(authority.expiresAtMs).toBe(f.wall + 15_000);
  f.clock.mockReturnValue(f.wall + 15_000);
  expect(() => authority.assertActive()).toThrow(
    "publication_authority_expired",
  );
});

test("wall-clock rollback during authority IO cannot extend the original window", () => {
  const f = fixture();
  f.clock.mockReturnValue(f.wall - 1);
  f.elapsed.mockReturnValue(f.monotonic + 30_000);
  expect(() => publicationDeadline(f.execution, f.wall + 120_000)).toThrow(
    "publication_authority_expired",
  );
});

test("the original SDK guard and abort signal remain live after deadline capture", async () => {
  const f = fixture();
  const authority = publicationDeadline(f.execution, f.wall + 120_000);
  await f.execution.checkpoint();
  expect(f.checkpoint).toHaveBeenCalledWith("publication");
  f.assertActive.mockImplementationOnce(() => {
    throw new Error("Original SDK refusal");
  });
  expect(() => authority.assertActive()).toThrow("Original SDK refusal");
  f.controller.abort(new Error("Original cancellation"));
  expect(() => authority.assertActive()).toThrow("Original cancellation");
});

test("capture precedes execution factory work and retains its exact numeric SDK deadline", () => {
  const f = fixture();
  const execution = capturePublicationExecution(() => {
    f.clock.mockReturnValue(f.wall + 10_000);
    f.elapsed.mockReturnValue(f.monotonic + 10_000);
    return f.execution;
  }, "publication");
  expect(execution.observed).toEqual({ wall: f.wall, monotonic: f.monotonic });
  expect(execution.expiresAtMs).toBe(f.execution.expiresAtMs);
  expect(publicationDeadline(execution, f.wall + 120_000).expiresAtMs).toBe(
    f.wall + 60_000,
  );
});

test.each([Number.NaN, Number.POSITIVE_INFINITY, 0, 1.5])(
  "invalid SDK expiry %s cannot become a root-derived fallback",
  (expiresAtMs) => {
    const f = fixture();
    expect(() =>
      publicationDeadline({ ...f.execution, expiresAtMs }, f.wall + 120_000),
    ).toThrow("publication_authority_expired");
  },
);
