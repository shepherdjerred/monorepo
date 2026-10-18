import { beforeEach, expect, test, vi } from "vitest";
import { RiotHttpError } from "#src/league/api/client/errors.ts";

const io = vi.hoisted(() => ({
  recovery: vi.fn(() => true),
  capture: vi.fn(),
}));
vi.mock("./admission.ts", () => ({ evidenceRecoveryEnabled: io.recovery }));
vi.mock("@sentry/bun", () => ({ captureException: io.capture }));
const { optionalSourceRead } = await import("./source-read.ts");

beforeEach(() => {
  io.recovery.mockReturnValue(true);
  io.capture.mockClear();
});

function forbidden() {
  return new RiotHttpError({
    status: 403,
    statusText: "Forbidden",
    body: { status: { status_code: 403, message: "Forbidden" } },
    url: "match-evidence",
    headers: new Headers(),
  });
}

test("beta reports forbidden Riot reads while allowing independent evidence to resolve", async () => {
  const error = forbidden();
  await expect(
    optionalSourceRead("RIOT", () => Promise.reject(error)),
  ).resolves.toBeUndefined();
  expect(io.capture).toHaveBeenCalledWith(error, {
    tags: { source: "evidence-acquisition", evidenceSource: "RIOT" },
  });
});

test("production retains its existing forbidden-read failure", async () => {
  io.recovery.mockReturnValue(false);
  const error = forbidden();
  await expect(
    optionalSourceRead("RIOT", () => Promise.reject(error)),
  ).rejects.toBe(error);
});

test("a forbidden read from another source is still a broken contract", async () => {
  const error = forbidden();
  await expect(
    optionalSourceRead("SCOUT_CLIENT", () => Promise.reject(error)),
  ).rejects.toBe(error);
});

test("internal and similarly shaped external errors still fail loudly", async () => {
  const error = Object.assign(new Error("Invalid stored contract"), {
    status: 403,
  });
  await expect(
    optionalSourceRead("RIOT", () => Promise.reject(error)),
  ).rejects.toBe(error);
});
