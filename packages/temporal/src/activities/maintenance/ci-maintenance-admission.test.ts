import { beforeEach, expect, test, vi } from "vitest";
import { Octokit } from "octokit";
import type * as MaintenanceClient from "./ci-maintenance-client.ts";
import {
  MaintenancePipelineSchema,
  type MaintenancePipeline,
} from "./ci-maintenance-client.ts";
import { ciMaintenanceActivities } from "./ci-maintenance.ts";
import type {
  MaintenanceCandidate,
  MaintenanceRequest,
} from "#shared/ci-maintenance.ts";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn<() => Promise<boolean>>(),
  pipelines: vi.fn<typeof MaintenanceClient.recentMaintenancePipelines>(),
  admission: vi.fn<typeof MaintenanceClient.maintenanceAdmissionBusy>(),
  github: vi.fn<typeof MaintenanceClient.maintenanceGithub>(),
  source: vi.fn<typeof MaintenanceClient.currentMaintenanceSource>(),
  verified: vi.fn<typeof MaintenanceClient.verifiedMaintenanceSource>(),
  candidates: vi.fn<typeof MaintenanceClient.maintenanceCandidates>(),
  receipt: vi.fn<typeof MaintenanceClient.findMaintenanceReceipt>(),
  api: vi.fn<typeof MaintenanceClient.maintenanceApi>(),
}));

vi.mock("#config/ci-maintenance.ts", () => ({
  ciMaintenanceEnabled: mocks.enabled,
}));
vi.mock("./ci-maintenance-client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof MaintenanceClient>()),
  recentMaintenancePipelines: mocks.pipelines,
  maintenanceAdmissionBusy: mocks.admission,
  maintenanceGithub: mocks.github,
  currentMaintenanceSource: mocks.source,
  verifiedMaintenanceSource: mocks.verified,
  maintenanceCandidates: mocks.candidates,
  findMaintenanceReceipt: mocks.receipt,
  maintenanceApi: mocks.api,
}));

const source = "a".repeat(40);
const candidate: MaintenanceCandidate = {
  kind: "ci-images",
  source,
  fingerprint: "image-v1",
  frozen: false,
};
const request: MaintenanceRequest = {
  ...candidate,
  requestId: "request-1",
  pipeline: null,
};
const canary: MaintenancePipeline = MaintenancePipelineSchema.parse({
  number: 20,
  commit: source,
  status: "running",
  event: "manual",
  branch: "ci-canary/ssd-ram",
  ref: "refs/heads/ci-canary/ssd-ram",
  message: "MANUAL PIPELINE @ ci-canary/ssd-ram",
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.enabled.mockResolvedValue(true);
  mocks.pipelines.mockResolvedValue([]);
  mocks.admission.mockResolvedValue(false);
  mocks.github.mockResolvedValue(new Octokit());
  mocks.source.mockResolvedValue(source);
  mocks.verified.mockResolvedValue(true);
  mocks.candidates.mockResolvedValue([candidate]);
});

test("inspection defers an active canary, then resumes naturally on its terminal receipt", async () => {
  mocks.admission.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect(await ciMaintenanceActivities.inspectCiMaintenance(null)).toEqual({
    enabled: true,
    candidates: [],
    pending: null,
    busy: true,
  });
  expect(mocks.github).not.toHaveBeenCalled();
  expect(await ciMaintenanceActivities.inspectCiMaintenance(null)).toEqual({
    enabled: true,
    candidates: [candidate],
    pending: null,
    busy: false,
  });
  expect(mocks.pipelines).not.toHaveBeenCalled();
  expect(mocks.admission).toHaveBeenCalledTimes(2);
});

test("a canary does not prevent reconciliation of an existing maintenance request", async () => {
  const maintenance = {
    ...canary,
    branch: "main",
    ref: "refs/heads/main",
    message: "ci-maintenance/request-1",
  };
  mocks.pipelines.mockResolvedValue([maintenance]);
  mocks.admission.mockResolvedValue(true);
  const receipt = {
    number: 12,
    source,
    status: "success",
    deferred: false,
  } satisfies Awaited<
    ReturnType<typeof MaintenanceClient.findMaintenanceReceipt>
  >;
  mocks.receipt.mockResolvedValue(receipt);
  expect(await ciMaintenanceActivities.inspectCiMaintenance(request)).toEqual({
    enabled: true,
    candidates: [],
    pending: receipt,
    busy: true,
  });
  expect(mocks.pipelines).toHaveBeenCalledWith("manual");
  expect(mocks.receipt).toHaveBeenCalledWith(request, [maintenance]);
  expect(mocks.api).not.toHaveBeenCalled();
});

test("submission rechecks a canary that arrived after candidate inspection without a POST", async () => {
  mocks.admission.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const observed = await ciMaintenanceActivities.inspectCiMaintenance(null);
  expect(observed.candidates).toEqual([candidate]);
  expect(await ciMaintenanceActivities.submitCiMaintenance(request)).toBeNull();
  expect(mocks.api).not.toHaveBeenCalled();
  expect(mocks.admission).toHaveBeenCalledTimes(2);
});

test("clear admission retains the single request-bound submission", async () => {
  mocks.api.mockResolvedValue({
    ...canary,
    number: 12,
    branch: "main",
    ref: "refs/heads/main",
    status: "created",
    message: "ci-maintenance/request-1",
  });
  expect(await ciMaintenanceActivities.submitCiMaintenance(request)).toBe(12);
  expect(mocks.api).toHaveBeenCalledTimes(1);
  expect(mocks.api).toHaveBeenCalledWith("", {
    method: "POST",
    body: JSON.stringify({
      branch: "main",
      message: "ci-maintenance/request-1",
      variables: {
        CI_MAINTENANCE_KIND: "ci-images",
        CI_MAINTENANCE_SOURCE: source,
        CI_MAINTENANCE_FINGERPRINT: "image-v1",
      },
    }),
  });
});

test("admission read failures reject without an external submission", async () => {
  mocks.admission.mockRejectedValue(new Error("Native CI read failed"));
  await expect(
    ciMaintenanceActivities.submitCiMaintenance(request),
  ).rejects.toThrow("Native CI read failed");
  expect(mocks.api).not.toHaveBeenCalled();
});
