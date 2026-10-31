import { expect, test } from "vitest";
import {
  initialMaintenanceState,
  nextMaintenanceCandidate,
  recordGoldenSnapshot,
  recordMaintenanceObservation,
  type MaintenanceCandidate,
} from "#shared/ci-maintenance.ts";
import {
  goldenMaintenanceFingerprint,
  imageMaintenanceFingerprint,
  isCompleteMain,
  maintenanceResult,
  MaintenancePipelineSchema,
  isActiveMaintenanceOrCanary,
} from "#activities/maintenance/ci-maintenance-client.ts";

const candidate: MaintenanceCandidate = {
  kind: "ci-images",
  source: "a".repeat(40),
  fingerprint: "image-v1",
  frozen: false,
};
const pending = () => ({ ...candidate, requestId: "request-1", pipeline: 12 });
const manualCanary = MaintenancePipelineSchema.parse({
  number: 20,
  commit: candidate.source,
  status: "running",
  event: "manual",
  branch: "ci-canary/ssd-ram",
  ref: "refs/heads/ci-canary/ssd-ram",
  message: "MANUAL PIPELINE @ ci-canary/ssd-ram",
});

test.each(["created", "pending", "running", "blocked"])(
  "a %s manual canary blocks automatic maintenance",
  (status) => {
    expect(
      isActiveMaintenanceOrCanary(
        MaintenancePipelineSchema.parse({ ...manualCanary, status }),
      ),
    ).toBe(true);
  },
);

test.each([
  "success",
  "failure",
  "error",
  "killed",
  "canceled",
  "declined",
  "skipped",
])("a %s canary releases maintenance admission", (status) => {
  expect(
    isActiveMaintenanceOrCanary(
      MaintenancePipelineSchema.parse({ ...manualCanary, status }),
    ),
  ).toBe(false);
});

test("canary ref pushes and ordinary manual runs do not hold maintenance", () => {
  expect(isActiveMaintenanceOrCanary({ ...manualCanary, event: "push" })).toBe(
    false,
  );
  expect(isActiveMaintenanceOrCanary({ ...manualCanary, branch: "main" })).toBe(
    false,
  );
  expect(
    isActiveMaintenanceOrCanary({
      ...manualCanary,
      branch: "main",
      message: "ci-maintenance/request-1",
    }),
  ).toBe(true);
});

test("unchanged inputs, ready PRs, and blocked streams do no work", () => {
  const state = initialMaintenanceState();
  expect(nextMaintenanceCandidate(state, [candidate])).toEqual(candidate);
  expect(
    nextMaintenanceCandidate(state, [{ ...candidate, frozen: true }]),
  ).toBeUndefined();
  state.completed["ci-images"] = candidate.fingerprint;
  expect(nextMaintenanceCandidate(state, [candidate])).toBeUndefined();
  state.blocked["ci-images"] = { requestId: "r", reason: "quota" };
  expect(
    nextMaintenanceCandidate(state, [{ ...candidate, fingerprint: "new" }]),
  ).toBeUndefined();
});
test("completed streams alternate so release churn cannot starve images", () => {
  const state = initialMaintenanceState();
  const release = { ...candidate, kind: "release-notes" as const };
  expect(nextMaintenanceCandidate(state, [candidate, release])?.kind).toBe(
    "release-notes",
  );
  state.lastKind = "release-notes";
  expect(nextMaintenanceCandidate(state, [candidate, release])?.kind).toBe(
    "ci-images",
  );
});
test("unknown submissions retain the request and cannot cause a new write", () => {
  const state = initialMaintenanceState();
  state.pending = pending();
  recordMaintenanceObservation(state, {
    enabled: true,
    candidates: [],
    pending: null,
    busy: false,
  });
  expect(state.pending?.requestId).toBe("request-1");
  expect(state.observation).toContain("operator reconciliation");
});
test.each([
  "success",
  "failure",
  "killed",
  "canceled",
  "created",
  "pending",
  "blocked",
  "running",
])("records %s without treating failure as success", (status) => {
  const state = initialMaintenanceState();
  state.pending = pending();
  recordMaintenanceObservation(state, {
    enabled: true,
    candidates: [],
    busy: false,
    pending: { number: 12, status, source: candidate.source },
  });
  expect(state.completed["ci-images"]).toBe(
    status === "success" ? candidate.fingerprint : undefined,
  );
  expect(state.pending !== null).toBe(
    ["created", "pending", "running", "blocked"].includes(status),
  );
  expect(state.blocked["ci-images"] !== undefined).toBe(
    ["failure", "killed", "canceled"].includes(status),
  );
});
test("deferral and a superseded source preserve the queued candidate", () => {
  for (const result of [
    { source: candidate.source, deferred: true },
    { source: "new-main" },
  ]) {
    const state = initialMaintenanceState();
    state.pending = pending();
    recordMaintenanceObservation(state, {
      enabled: true,
      candidates: [],
      busy: false,
      pending: { number: 12, status: "success", ...result },
    });
    expect(state.pending).toBeNull();
    expect(state.completed).toEqual({});
    expect(state.blocked).toEqual({});
  }
});
test("image fingerprint ignores application edits and changes with either Dockerfile or tool pins", () => {
  const tree = [
    ".mise.toml",
    "mise.lock",
    "ci/ci-image/Dockerfile",
    "ci/ci-playwright/Dockerfile",
  ].map((path) => ({ path, sha: "a" }));
  const hash = imageMaintenanceFingerprint(tree);
  expect(
    imageMaintenanceFingerprint([
      ...tree,
      { path: "packages/app/main.ts", sha: "b" },
    ]),
  ).toBe(hash);
  for (let index = 0; index < tree.length; index++)
    expect(
      imageMaintenanceFingerprint(
        tree.map((entry, i) => ({
          ...entry,
          sha: i === index ? "b" : entry.sha,
        })),
      ),
    ).not.toBe(hash);
  expect(() => imageMaintenanceFingerprint([])).toThrow(
    "Missing CI image input",
  );
});
test("maintenance success cannot qualify as verified main", () => {
  const pipeline = MaintenancePipelineSchema.parse({
    number: 1,
    status: "success",
    commit: candidate.source,
    branch: "main",
    ref: "refs/heads/main",
    event: "manual",
    message: "maintenance",
    workflows: [{ name: "maintenance-ci-images", state: "success" }],
  });
  expect(isCompleteMain(pipeline, candidate.source)).toBe(false);
  pipeline.workflows = [
    "verify",
    "images",
    "helm-push",
    "delivery-publish",
  ].map((name) => ({ name, state: "success" as const }));
  expect(isCompleteMain(pipeline, candidate.source)).toBe(true);
});
test("created native receipts remain pending, never verified main", () => {
  const pipeline = MaintenancePipelineSchema.parse({
    number: 12,
    status: "created",
    commit: candidate.source,
    branch: "main",
    ref: "refs/heads/main",
    event: "manual",
    message: "ci-maintenance/request-1",
    workflows: [{ name: "maintenance-ci-images", state: "pending" }],
  });
  expect(isCompleteMain(pipeline, candidate.source)).toBe(false);
  const state = initialMaintenanceState();
  state.pending = pending();
  recordMaintenanceObservation(state, {
    enabled: true,
    candidates: [],
    busy: true,
    pending: {
      number: pipeline.number,
      status: pipeline.status,
      source: pipeline.commit,
    },
  });
  expect(state.pending?.requestId).toBe("request-1");
  expect(state.completed).toEqual({});
  expect(state.blocked).toEqual({});
  expect(state.observation).toBe("Pipeline 12 is created");
});
test("canceled native receipts are terminal failures, never verified main", () => {
  const pipeline = MaintenancePipelineSchema.parse({
    number: 12,
    status: "canceled",
    commit: candidate.source,
    branch: "main",
    ref: "refs/heads/main",
    event: "manual",
    message: "ci-maintenance/request-1",
    workflows: [{ name: "maintenance-ci-images", state: "skipped" }],
  });
  expect(isCompleteMain(pipeline, candidate.source)).toBe(false);
  const state = initialMaintenanceState();
  state.pending = pending();
  recordMaintenanceObservation(state, {
    enabled: true,
    candidates: [],
    busy: false,
    pending: {
      number: pipeline.number,
      status: pipeline.status,
      source: pipeline.commit,
    },
  });
  expect(state.pending).toBeNull();
  expect(state.completed).toEqual({});
  expect(state.blocked["ci-images"]?.reason).toContain("ended canceled");
  expect(nextMaintenanceCandidate(state, [candidate])).toBeUndefined();
});
test("requires exactly one structured result receipt", () => {
  const entry = {
    line: 3,
    data: Buffer.from('CI_MAINTENANCE_RESULT {"status":"deferred"}\n').toString(
      "base64",
    ),
  };
  expect(maintenanceResult([entry])).toEqual({ status: "deferred" });
  expect(() => maintenanceResult([])).toThrow("unique result receipt");
  expect(() => maintenanceResult([entry, entry])).toThrow(
    "unique result receipt",
  );
});

test("a golden refresh completes only once its claim is snapshotted and selected", () => {
  const state = initialMaintenanceState();
  const golden = { ...candidate, kind: "workspace-golden" as const };
  state.pending = { ...golden, requestId: "request-1", pipeline: 12 };
  recordMaintenanceObservation(state, {
    enabled: true,
    candidates: [],
    busy: false,
    pending: { number: 12, status: "success", source: candidate.source },
  });
  expect(state.pending).toBeNull();
  expect(state.completed["workspace-golden"]).toBeUndefined();
  expect(state.goldenSnapshot?.requestId).toBe("request-1");
  // No second publish may rewrite the claim before it is snapshotted.
  expect(
    nextMaintenanceCandidate(state, [{ ...golden, fingerprint: "next" }]),
  ).toBeUndefined();
  expect(nextMaintenanceCandidate(state, [golden, candidate])?.kind).toBe(
    "ci-images",
  );
  recordGoldenSnapshot(state, "ci-workspace-golden-aaaaaaaaaaaa-request-");
  expect(state.goldenSnapshot).toBeNull();
  expect(state.completed["workspace-golden"]).toBe(candidate.fingerprint);
  expect(state.observation).toContain("ci-workspace-golden-");
});

test("a coordinator state from before golden refreshes selects golden work", () => {
  const { goldenSnapshot: _omitted, ...legacy } = initialMaintenanceState();
  const golden = { ...candidate, kind: "workspace-golden" as const };
  expect(nextMaintenanceCandidate(legacy, [golden])).toEqual(golden);
  recordGoldenSnapshot(legacy, "unused");
  expect(legacy.completed["workspace-golden"]).toBeUndefined();
});

test("the golden fingerprint follows dependency inputs and the UTC day", () => {
  const tree = [
    "bun.lock",
    "bunfig.toml",
    "package.json",
    "patches",
    ".mise.toml",
    "mise.lock",
    "ci/ci-image/Dockerfile",
  ].map((path) => ({ path, sha: `${path}-v1` }));
  const day = new Date("2026-10-29T03:00:00Z");
  const base = goldenMaintenanceFingerprint(tree, day);
  expect(
    goldenMaintenanceFingerprint(tree, new Date("2026-10-29T23:59:00Z")),
  ).toBe(base);
  expect(
    goldenMaintenanceFingerprint(tree, new Date("2026-10-30T00:00:00Z")),
  ).not.toBe(base);
  expect(
    goldenMaintenanceFingerprint(
      tree.map((entry) =>
        entry.path === "bun.lock" ? { ...entry, sha: "bun.lock-v2" } : entry,
      ),
      day,
    ),
  ).not.toBe(base);
  expect(() =>
    goldenMaintenanceFingerprint(
      tree.filter((entry) => entry.path !== "patches"),
      day,
    ),
  ).toThrow("Missing golden workspace input patches");
});
