import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import type * as MaintenanceClient from "./ci-maintenance-client.ts";
import {
  MaintenancePipelineSchema,
  type MaintenancePipeline,
} from "./ci-maintenance-client.ts";
import { ciExtendedVerifyActivities } from "./ci-extended-verify.ts";
import type { ExtendedVerifyRequest } from "#shared/ci-extended-verify.ts";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn<() => Promise<boolean>>(),
  pipelines: vi.fn<typeof MaintenanceClient.recentMaintenancePipelines>(),
  pipeline: vi.fn<typeof MaintenanceClient.maintenancePipeline>(),
  admission: vi.fn<typeof MaintenanceClient.maintenanceAdmissionBusy>(),
  verified: vi.fn<typeof MaintenanceClient.newestVerifiedMaintenanceSource>(),
  api: vi.fn<typeof MaintenanceClient.maintenanceApi>(),
}));

vi.mock("#config/ci-extended-verify.ts", () => ({
  ciExtendedVerifyEnabled: mocks.enabled,
}));
vi.mock("./ci-maintenance-client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof MaintenanceClient>()),
  recentMaintenancePipelines: mocks.pipelines,
  maintenancePipeline: mocks.pipeline,
  maintenanceAdmissionBusy: mocks.admission,
  newestVerifiedMaintenanceSource: mocks.verified,
  maintenanceApi: mocks.api,
}));

const source = "a".repeat(40);
const request: ExtendedVerifyRequest = { requestId: "request-1", source };
const created: MaintenancePipeline = MaintenancePipelineSchema.parse({
  number: 77,
  commit: "b".repeat(40),
  status: "created",
  event: "manual",
  branch: "main",
  ref: "refs/heads/main",
  message: "ci-extended-verify/request-1",
  workflows: [{ name: "verify-extended", state: "pending" }],
});
const url = "https://woodpecker.sjer.red/repos/1/pipeline/77";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.stubEnv("WOODPECKER_URL", "https://woodpecker.sjer.red");
  vi.stubEnv("WOODPECKER_REPO_ID", "1");
  vi.stubEnv("WOODPECKER_TOKEN", "unit-test-token");
  mocks.enabled.mockResolvedValue(true);
  mocks.pipelines.mockResolvedValue([]);
  mocks.admission.mockResolvedValue(false);
  mocks.verified.mockResolvedValue(source);
});
afterEach(() => vi.unstubAllEnvs());

test("the source is the newest complete main build, or null", async () => {
  expect(await ciExtendedVerifyActivities.selectExtendedVerifySource()).toBe(
    source,
  );
  mocks.verified.mockResolvedValue(undefined);
  expect(
    await ciExtendedVerifyActivities.selectExtendedVerifySource(),
  ).toBeNull();
});

test("submission posts one manual main pipeline carrying the request contract", async () => {
  mocks.api.mockResolvedValue(created);
  expect(
    await ciExtendedVerifyActivities.submitExtendedVerify(request),
  ).toEqual({
    kind: "submitted",
    receipt: {
      number: 77,
      url,
      commit: "b".repeat(40),
      status: "created",
      workflows: [{ name: "verify-extended", state: "pending" }],
    },
  });
  expect(mocks.api).toHaveBeenCalledExactlyOnceWith("", {
    method: "POST",
    body: JSON.stringify({
      branch: "main",
      message: "ci-extended-verify/request-1",
      variables: {
        CI_EXTENDED_REQUEST: "request-1",
        CI_EXTENDED_SOURCE: source,
      },
    }),
  });
  const body = z
    .object({
      message: z.string(),
      variables: z.record(z.string(), z.string()),
    })
    .parse(JSON.parse(z.string().parse(mocks.api.mock.calls[0]?.[1]?.body)));
  expect(body.message).not.toContain("ci-maintenance/");
  expect(Object.keys(body.variables)).toEqual([
    "CI_EXTENDED_REQUEST",
    "CI_EXTENDED_SOURCE",
  ]);
});

test("a disabled flag skips before any Woodpecker read or write", async () => {
  mocks.enabled.mockResolvedValue(false);
  expect(
    await ciExtendedVerifyActivities.submitExtendedVerify(request),
  ).toEqual({ kind: "skipped", reason: "disabled" });
  expect(mocks.pipelines).not.toHaveBeenCalled();
  expect(mocks.admission).not.toHaveBeenCalled();
  expect(mocks.api).not.toHaveBeenCalled();
});

test("an active canary or maintenance pipeline defers without a POST", async () => {
  mocks.admission.mockResolvedValue(true);
  const submission =
    await ciExtendedVerifyActivities.submitExtendedVerify(request);
  expect(submission.kind).toBe("deferred");
  expect(mocks.api).not.toHaveBeenCalled();
});

test("a request that already has a receipt is returned, never resubmitted", async () => {
  const running = { ...created, status: "running" as const };
  mocks.pipelines.mockResolvedValue([
    { ...created, number: 70, message: "ci-extended-verify/other" },
    running,
  ]);
  mocks.pipeline.mockResolvedValue(running);
  expect(
    await ciExtendedVerifyActivities.submitExtendedVerify(request),
  ).toEqual({
    kind: "submitted",
    receipt: expect.objectContaining({ number: 77 }),
  });
  expect(mocks.pipelines).toHaveBeenCalledWith("manual");
  expect(mocks.pipeline).toHaveBeenCalledWith(77);
  expect(mocks.admission).not.toHaveBeenCalled();
  expect(mocks.api).not.toHaveBeenCalled();
  expect(
    await ciExtendedVerifyActivities.findExtendedVerifyReceipt("request-1"),
  ).toMatchObject({ number: 77, url, status: "running" });
  expect(
    await ciExtendedVerifyActivities.findExtendedVerifyReceipt("request-9"),
  ).toBeNull();
});

test("duplicate receipts for one request fail instead of guessing", async () => {
  mocks.pipelines.mockResolvedValue([created, { ...created, number: 78 }]);
  await expect(
    ciExtendedVerifyActivities.findExtendedVerifyReceipt("request-1"),
  ).rejects.toThrow("Duplicate extended verify request receipts");
});

test("admission read failures reject without an external submission", async () => {
  mocks.admission.mockRejectedValue(new Error("Native CI read failed"));
  await expect(
    ciExtendedVerifyActivities.submitExtendedVerify(request),
  ).rejects.toThrow("Native CI read failed");
  expect(mocks.api).not.toHaveBeenCalled();
});

test("describe returns the receipt with its UI URL and rejects foreign pipelines", async () => {
  mocks.pipeline.mockResolvedValue({
    ...created,
    status: "failure",
    workflows: [{ name: "verify-extended", state: "failure" }],
  });
  expect(await ciExtendedVerifyActivities.describeExtendedVerify(77)).toEqual({
    number: 77,
    url,
    commit: "b".repeat(40),
    status: "failure",
    workflows: [{ name: "verify-extended", state: "failure" }],
  });
  for (const foreign of [
    { ...created, message: "ci-maintenance/request-1" },
    { ...created, event: "push" },
    { ...created, branch: "ci-canary/ssd-ram" },
  ]) {
    mocks.pipeline.mockResolvedValue(foreign);
    await expect(
      ciExtendedVerifyActivities.describeExtendedVerify(77),
    ).rejects.toThrow("identity mismatch");
  }
});
