import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  maintenanceAdmissionBusy,
  MaintenancePipelineSchema,
  recentMaintenancePipelines,
} from "./ci-maintenance-client.ts";

const canary = MaintenancePipelineSchema.parse({
  number: 20,
  commit: "a".repeat(40),
  status: "running",
  event: "manual",
  branch: "ci-canary/ssd-ram",
  ref: "refs/heads/ci-canary/ssd-ram",
  message: "MANUAL PIPELINE @ ci-canary/ssd-ram",
});

beforeEach(() => {
  vi.stubEnv("WOODPECKER_URL", "https://woodpecker.sjer.red");
  vi.stubEnv("WOODPECKER_REPO_ID", "1");
  vi.stubEnv("WOODPECKER_TOKEN", "unit-test-token");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function nativeUrl(input: Parameters<typeof fetch>[0]): URL {
  if (!(input instanceof URL)) throw new TypeError("Expected native API URL");
  return input;
}

test.each(["created", "pending", "running", "blocked"])(
  "active %s canaries remain visible regardless of completed history size",
  async (status) => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const query = nativeUrl(input).searchParams;
      return Promise.resolve(
        Response.json(
          query.get("status") === status ? [{ ...canary, status }] : [],
        ),
      );
    });
    expect(await maintenanceAdmissionBusy()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);
    for (const [input, init] of fetch.mock.calls) {
      const url = nativeUrl(input);
      expect(url.pathname).toBe("/api/repos/1/pipelines");
      expect(url.searchParams.get("event")).toBe("manual");
      expect(url.searchParams.get("branch")).toBeNull();
      expect(url.searchParams.get("page")).toBe("1");
      expect(url.searchParams.get("perPage")).toBe("50");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  },
);

test("empty active-status results release admission without traversing completed history", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(Response.json([])));
  expect(await maintenanceAdmissionBusy()).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(
    new Set(
      fetch.mock.calls.map(([input]) =>
        nativeUrl(input).searchParams.get("status"),
      ),
    ),
  ).toEqual(new Set(["blocked", "created", "pending", "running"]));
});

test("a saturated active page defers instead of missing a canary beyond its bound", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input) =>
    Promise.resolve(
      Response.json(
        nativeUrl(input).searchParams.get("status") === "running"
          ? Array.from({ length: 50 }, (_, index) => ({
              ...canary,
              number: index + 100,
              branch: "main",
              ref: "refs/heads/main",
              message: "ordinary manual run",
            }))
          : [],
      ),
    ),
  );
  expect(await maintenanceAdmissionBusy()).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(4);
});

test("a broken native status filter fails instead of granting admission", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(Response.json([{ ...canary, status: "success" }])),
  );
  await expect(maintenanceAdmissionBusy()).rejects.toThrow(
    "active-status filter was not applied",
  );
});

test("native read errors fail instead of granting admission", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 503 }),
  );
  await expect(maintenanceAdmissionBusy()).rejects.toThrow("HTTP 503");
});

test("receipt history retains its bounded main-only query", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = nativeUrl(input);
    expect(url.searchParams.get("branch")).toBe("main");
    expect(url.searchParams.get("event")).toBe("manual");
    expect(url.searchParams.get("status")).toBeNull();
    const page = Number(url.searchParams.get("page"));
    return Promise.resolve(
      Response.json(
        Array.from({ length: 50 }, (_, index) => ({
          ...canary,
          number: page * 100 + index,
          branch: "main",
          ref: "refs/heads/main",
          status: "success",
        })),
      ),
    );
  });
  expect(await recentMaintenancePipelines("manual")).toHaveLength(200);
  expect(fetch).toHaveBeenCalledTimes(4);
});
