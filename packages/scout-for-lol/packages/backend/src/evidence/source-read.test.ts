import { beforeEach, expect, test, vi } from "vitest";
import { RiotHttpError } from "#src/league/api/client/errors.ts";

const io = vi.hoisted(() => ({
  recovery: vi.fn(() => true),
  capture: vi.fn(),
}));
vi.mock("./admission.ts", () => ({ evidenceRecoveryEnabled: io.recovery }));
vi.mock("@sentry/bun", () => ({ captureException: io.capture }));
const {
  expectedRiotAbsenceStatuses,
  optionalSourceRead,
  readSource,
  riotAbsenceOf,
} = await import("./source-read.ts");

beforeEach(() => {
  io.recovery.mockReturnValue(true);
  io.capture.mockClear();
});

function riotError(status: number) {
  return new RiotHttpError({
    status,
    statusText: "Forbidden",
    body: { status: { status_code: status, message: "Forbidden" } },
    url: "match-evidence",
    headers: new Headers(),
  });
}

function forbidden() {
  return riotError(403);
}

test("beta allows independent evidence without duplicating Riot error reporting", async () => {
  const error = forbidden();
  await expect(
    optionalSourceRead("RIOT", () => Promise.reject(error)),
  ).resolves.toBeUndefined();
  expect(io.capture).not.toHaveBeenCalled();
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

test("beta reports Riot's definitive refusals as absence", async () => {
  await expect(
    readSource("RIOT", () => Promise.reject(forbidden())),
  ).resolves.toEqual({ kind: "absent", absence: "forbidden" });
  await expect(
    readSource("RIOT", () => Promise.reject(riotError(404))),
  ).resolves.toEqual({ kind: "absent", absence: "not_found" });
  expect(io.capture).not.toHaveBeenCalled();
});

test("outages and expired deadlines are retryable failures, not absence", async () => {
  await expect(
    readSource("RIOT", () => Promise.reject(riotError(503))),
  ).resolves.toEqual({ kind: "failed" });
  await expect(
    readSource("RIOT", () => Promise.reject(new Error("never read")), 0),
  ).resolves.toEqual({ kind: "failed" });
  expect(io.capture).toHaveBeenCalledOnce();
});

test("a 404-tolerant read that resolved empty is Riot's not-found answer", () => {
  expect(riotAbsenceOf({ kind: "read", value: undefined })).toBe("not_found");
  expect(riotAbsenceOf({ kind: "read", value: 1 })).toBeUndefined();
  expect(riotAbsenceOf({ kind: "absent", absence: "forbidden" })).toBe(
    "forbidden",
  );
  expect(riotAbsenceOf({ kind: "failed" })).toBeUndefined();
});

test("only beta tells the Riot caller that a 403 is expected", () => {
  expect(expectedRiotAbsenceStatuses()).toEqual([403]);
  io.recovery.mockReturnValue(false);
  expect(expectedRiotAbsenceStatuses()).toEqual([]);
});
