import { expect, test } from "vitest";
import { z } from "zod";
import { SERVICE_CATALOG } from "@shepherdjerred/ops-model/catalog.ts";
import { bootstrapFingerprint } from "./bootstrap-selection.ts";
import {
  HandoverContextSchema,
  HandoverDescriptorSchema,
  handoverContext,
} from "./delivery-handover-selection.ts";

test("the API context lists only delegated leaf targets now that the root release is retired", async () => {
  const directory = new URL(
    "../../../delivery/registrations/",
    import.meta.url,
  );
  const files = [
    "arcade.pipeline.json",
    ...new Bun.Glob("**/pipeline.json").scanSync({
      cwd: directory.pathname,
      onlyFiles: true,
    }),
  ];
  const rows = await Promise.all(
    files.map(async (file) => {
      const environment = z
        .record(z.string(), z.unknown())
        .parse(
          await Bun.file(
            new URL(
              file.replace(/pipeline\.json$/u, "environment.json"),
              directory,
            ),
          ).json(),
        );
      const pipeline = z
        .record(z.string(), z.unknown())
        .parse(await Bun.file(new URL(file, directory)).json());
      const environmentId = z.string().parse(environment["id"]);
      const kind =
        pipeline["workerRollout"] === undefined
          ? pipeline["forumRelease"] === undefined
            ? null
            : "forum"
          : "worker";
      return {
        environmentId,
        serviceId: environment["serviceId"],
        application: environment["application"],
        generation: 0,
        pipelineRevisionId: environment["pipelineRevisionId"],
        configurationRevision: environment["configurationRevision"],
        configuration: environment["configuration"],
        pipeline,
        acceptedVersionSetRevisionId: null,
        baseline:
          kind === null
            ? null
            : {
                kind,
                id: `baseline/${environmentId}`,
                fingerprint: `sha256:${"b".repeat(64)}`,
              },
      };
    }),
  );
  const raw = {
    schema: "delivery-ownership-context/v1",
    sourceRevision: "a".repeat(40),
    catalogFingerprint: bootstrapFingerprint(SERVICE_CATALOG),
    catalogRevision: `sha256:${"c".repeat(64)}`,
    observedAt: new Date().toISOString(),
    writesEnabled: false,
    admittingEnvironments: [],
    counts: {
      applicationLocks: 0,
      platformLocks: 0,
      activeEnvironments: 0,
      pendingDeployments: 0,
      recoveryRequired: 0,
      pendingObservations: 0,
    },
    targets: rows.filter(
      (row) =>
        typeof row.application === "string" &&
        SERVICE_CATALOG.deliveryDelegations?.[row.application] ===
          row.environmentId,
    ),
  };
  // Shared-site and root registrations are retired (X4, X6); their
  // successors come from the catalog document, not a handover.
  const registered = new Set(raw.targets.map((row) => row.environmentId));
  const descriptor = HandoverDescriptorSchema.parse({
    schema: "delivery-ownership-handover/v1",
    sourceRevision: raw.sourceRevision,
    catalogRevision: raw.catalogRevision,
    pullRequest: 1,
    requestId: "11111111-1111-4111-8111-111111111111",
    deliveryUrl: "https://delivery.tailnet-1a49.ts.net",
    woodpeckerWebhookId: 7,
    targets: Object.entries(SERVICE_CATALOG.deliveryDelegations ?? {})
      .filter(([, environmentId]) => registered.has(environmentId))
      .map(([application, environmentId]) => ({
        application,
        environmentId,
        expectedGeneration: 0,
      })),
  });
  expect(descriptor.targets).toHaveLength(18);
  const observed = handoverContext(raw, descriptor);
  expect(observed.targets).toHaveLength(18);
  expect(
    observed.targets.some((row) => row.environmentId === "gitops/root"),
  ).toBe(false);
  expect(() =>
    handoverContext(raw, {
      ...descriptor,
      targets: [
        {
          application: "apps",
          environmentId: "gitops/root",
          expectedGeneration: 0,
        },
      ],
    }),
  ).toThrow("exact reviewed source delegation");
  const [leaf] = observed.targets;
  if (leaf === undefined) throw new Error("Leaf context row missing");
  expect(() =>
    HandoverContextSchema.parse({
      ...raw,
      targets: [{ ...leaf, pipeline: { kind: "unknown" } }],
    }),
  ).toThrow();
});
