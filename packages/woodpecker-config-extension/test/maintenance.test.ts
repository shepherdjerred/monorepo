import { expect, test } from "vitest";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { selectSteps } from "#src/pipeline/select.ts";
import {
  separateMaintenance,
  maintenanceSteps,
  eligibleMaintenanceSteps,
  maintenanceSourcePipeline,
} from "#src/pipeline/maintenance.ts";
import { PipelineSchema } from "#src/schemas.ts";
import fixture from "./fixtures/woodpecker-v3.18.1-config-request.json" with { type: "json" };
import { TEST_IMAGES } from "./identity.ts";

test("seed maintenance requires the exact fully verified source, including manual requests", async () => {
  const pipeline = PipelineSchema.parse(fixture.pipeline);
  for (const green of [undefined, "b".repeat(40)]) {
    const steps = await eligibleMaintenanceSteps(
      TEST_IMAGES,
      "workspace-seeds",
      pipeline,
      () => Promise.resolve(green),
    );
    expect(steps[0]?.key).toBe("maintenance-unverified");
    expect(steps[0]?.commands).toContain("exit 1");
  }
  const verified = await eligibleMaintenanceSteps(
    TEST_IMAGES,
    "workspace-seeds",
    pipeline,
    () => Promise.resolve(pipeline.commit),
  );
  expect(verified[0]?.key).toBe("maintenance-workspace-seeds");
});
test("only the verified source replaces the tip, and any other source supersedes the request", async () => {
  const tip = PipelineSchema.parse(fixture.pipeline);
  const verified = "b".repeat(40);
  const requested = {
    ...tip,
    variables: { ...tip.variables, CI_MAINTENANCE_SOURCE: verified },
  };
  expect(maintenanceSourcePipeline(requested, verified).commit).toBe(verified);
  expect(maintenanceSourcePipeline(requested, "c".repeat(40))).toBe(requested);
  expect(maintenanceSourcePipeline(requested, undefined)).toBe(requested);
  expect(maintenanceSourcePipeline(tip, verified)).toBe(tip);
  // A stale golden request is superseded, not failed into a blocked kind.
  const stale = await eligibleMaintenanceSteps(
    TEST_IMAGES,
    "workspace-golden",
    requested,
    () => Promise.resolve("c".repeat(40)),
  );
  expect(stale.map((step) => step.key)).toEqual(["maintenance-superseded"]);
  const adopted = await eligibleMaintenanceSteps(
    TEST_IMAGES,
    "workspace-golden",
    maintenanceSourcePipeline(requested, verified),
    () => Promise.resolve(verified),
  );
  expect(adopted.map((step) => step.key)).toEqual([
    "maintenance-workspace-golden",
  ]);
});
test("workspace seeds publish both isolated profiles and emit their final receipt only after both", () => {
  const [step] = maintenanceSteps(TEST_IMAGES, "workspace-seeds");
  expect(step?.key).toBe("maintenance-workspace-seeds");
  expect(step?.volumes?.map((volume) => volume.claim)).toContain(
    "woodpecker-workspace-seeds",
  );
  expect(step?.commands.join("\n")).toContain(
    "flock -x /woodpecker/source-control/seeds.lock",
  );
  expect(step?.orderedSteps?.map((child) => child.key)).toEqual([
    "workspace-seed-browser",
    "workspace-seeds-result",
  ]);
  expect(step?.orderedSteps?.[0]?.commands).toContain(
    "cd /woodpecker/browser-seed",
  );
  expect(step?.orderedSteps?.[1]?.commands.join("\n")).toContain(
    "publish-workspace-seed.ts result",
  );
  expect(step?.commands.join("\n")).not.toContain(
    "publish-workspace-seed.ts result",
  );
});

test.each(["release-notes", "ci-images"] as const)(
  "%s selects the automation toolchain through its scope contract",
  (kind) => {
    expect(maintenanceSteps(TEST_IMAGES, kind)[0]?.commands[0]).toBe(
      "MISE_TOOLCHAIN_SCOPE=automation . ci/scripts/toolchain.sh",
    );
  },
);

test("the manual image refresh registers no Delivery build and holds no publisher identity", () => {
  const maintenance = maintenanceSteps(TEST_IMAGES, "ci-images")[0];
  if (maintenance === undefined) throw new Error("Maintenance lane missing");
  expect(maintenance.environment?.["DELIVERY_URL"]).toBeUndefined();
  expect(
    maintenance.secrets?.some(
      (grant) =>
        grant.secret === "ci-delivery-credentials" ||
        grant.env === "DELIVERY_API_TOKEN",
    ),
  ).toBe(false);
  expect(maintenance.commands.join("\n")).not.toContain(
    "register-ci-image-build.ts",
  );
  // The main-pipeline refresh steps keep the identity they register with.
  const graph = buildPipelineSteps({
    images: TEST_IMAGES,
    changedBase: "base",
  });
  for (const key of ["ci-base-refresh", "ci-playwright-refresh"]) {
    const refresh = graph.find((step) => step.key === key);
    expect(refresh?.environment?.["DELIVERY_URL"]).toBe(
      "http://delivery.delivery.svc.cluster.local:7353",
    );
    expect(
      refresh?.secrets?.some(
        (grant) => grant.secret === "ci-delivery-credentials",
      ),
    ).toBe(true);
  }
});

test("separation removes only maintenance and retains publication and verification gates", () => {
  const before = buildPipelineSteps({
    images: TEST_IMAGES,
    changedBase: "base",
  });
  const after = separateMaintenance(before);
  expect(
    before
      .filter((step) => !after.some((other) => other.key === step.key))
      .map((step) => step.key),
  ).toEqual(["ci-base-refresh", "ci-playwright-refresh"]);
  expect(after.find((step) => step.key === "helm-push")?.dependsOn).toEqual([
    "images",
  ]);
  expect(after.find((step) => step.key === "publish")?.dependsOn).toContain(
    "release-please",
  );
  expect(
    after.find((step) => step.key === "release-please")?.commands,
  ).toContain(
    "bun --no-install scripts/release/release.ts --phase github-release",
  );
  for (const key of ["verify", "playwright-e2e", "images", "publish"]) {
    expect(after.find((step) => step.key === key)).toEqual(
      before.find((step) => step.key === key),
    );
  }
});

test.each([false, true])(
  "separated maintenance has complete PR and main dependency graphs (catalog=%s)",
  (deliveryPublication) => {
    const graph = separateMaintenance(
      buildPipelineSteps({
        images: TEST_IMAGES,
        changedBase: "base",
        deliveryPublication,
      }),
    );
    for (const event of ["pull_request", "push"]) {
      const selected = selectSteps(graph, {
        event,
        branch: "main",
        defaultBranch: "main",
        changedFiles: [],
      });
      const keys = new Set(selected.map((step) => step.key));
      expect(keys.has("verify")).toBe(true);
      for (const step of selected) {
        for (const dependency of step.dependsOn ?? [])
          expect(
            keys.has(dependency),
            `${event}/${step.key}/${dependency}`,
          ).toBe(true);
      }
      expect(keys.has("helm-push")).toBe(event === "push");
      expect(keys.has("delivery-publish")).toBe(
        event === "push" && deliveryPublication,
      );
      expect(keys.has("homelab-release-admission")).toBe(false);
    }
  },
);
