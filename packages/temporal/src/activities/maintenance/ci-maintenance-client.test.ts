import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  findMaintenanceReceipt,
  maintenanceAdmissionBusy,
  MaintenancePipelineSchema,
  newestVerifiedMaintenanceSource,
  recentMaintenancePipelines,
} from "./ci-maintenance-client.ts";
import type { MaintenanceRequest } from "#shared/ci-maintenance.ts";

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

const verifiedSource = "b".repeat(40);
const mainPush = {
  ...canary,
  event: "push",
  branch: "main",
  ref: "refs/heads/main",
  status: "success",
  message: "feat: change",
};
const releaseWorkflows = ["verify", "images", "helm-push", "delivery-publish"];

function servePipelines(
  list: readonly object[],
  details: Record<number, object>,
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = nativeUrl(input);
    const number = /\/pipelines\/(\d+)$/u.exec(url.pathname)?.[1];
    return Promise.resolve(
      Response.json(number === undefined ? list : details[Number(number)]),
    );
  });
}

test("maintenance targets the newest successful main push when it is a complete release build", async () => {
  const newest = { ...mainPush, number: 31, commit: verifiedSource };
  const fetch = servePipelines(
    [
      { ...mainPush, number: 32, commit: "c".repeat(40), status: "running" },
      newest,
      { ...mainPush, number: 29 },
    ],
    {
      31: {
        ...newest,
        workflows: releaseWorkflows.map((name) => ({
          name,
          state: "success",
        })),
      },
    },
  );
  expect(await newestVerifiedMaintenanceSource()).toBe(verifiedSource);
  const listing = nativeUrl(fetch.mock.calls[0]?.[0] ?? "");
  expect(listing.searchParams.get("event")).toBe("push");
  expect(listing.searchParams.get("branch")).toBe("main");
});

test("an incomplete newest build is not replaced by an older one", async () => {
  const newest = { ...mainPush, number: 31, commit: verifiedSource };
  servePipelines([newest, { ...mainPush, number: 29 }], {
    31: {
      ...newest,
      workflows: [{ name: "verify", state: "success" }],
    },
  });
  expect(await newestVerifiedMaintenanceSource()).toBeUndefined();
});

test("a receipt at the branch tip reports the verified source the extension ran", async () => {
  const request: MaintenanceRequest = {
    kind: "workspace-golden",
    source: verifiedSource,
    fingerprint: "golden-v1",
    frozen: false,
    requestId: "request-1",
    pipeline: 40,
  };
  const receipt = {
    ...canary,
    number: 40,
    branch: "main",
    ref: "refs/heads/main",
    status: "running",
    message: "ci-maintenance/request-1",
  };
  servePipelines([], {
    40: {
      ...receipt,
      workflows: [{ name: "maintenance-workspace-golden", state: "running" }],
    },
  });
  expect(await findMaintenanceReceipt(request, [])).toMatchObject({
    number: 40,
    source: verifiedSource,
  });
  vi.restoreAllMocks();
  servePipelines([], {
    40: {
      ...receipt,
      status: "success",
      workflows: [{ name: "maintenance-superseded", state: "success" }],
    },
  });
  expect(await findMaintenanceReceipt(request, [])).toEqual({
    number: 40,
    source: canary.commit,
    status: "success",
  });
});
