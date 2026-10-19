import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import { releasePrunesChart } from "homelab/scripts/helm/helm-release-core.ts";
import { z } from "zod";
import { HOMELAB_RELEASE_RESULT_FILE } from "homelab/scripts/argocd/argocd-release-result.ts";
import { releaseRoot } from "homelab/scripts/argocd/argocd.ts";
import { admitPlatformNativeJob } from "#lib/delivery/platform/native-job.ts";
import type { DeliveryJobRequest } from "#shared/delivery-job.ts";

export const RootReleaseInputSchema = z
  .object({
    requestId: z.uuid(),
    charts: z
      .array(
        z
          .object({
            name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
            artifact: ArtifactVersionSchema,
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.charts.some((chart) =>
        ["temporal", "delivery-control-plane"].includes(chart.name),
      )
    )
      context.addIssue({
        code: "custom",
        message:
          "Root platform cutover requires central worker Application delegation first; root cannot mutate protected Delivery control-plane templates",
      });

    if (
      new Set(input.charts.map((chart) => chart.name)).size !==
        input.charts.length ||
      !input.charts.some((chart) => chart.name === "apps")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Root release requires one unique exact inventory including apps",
      });
    }
    for (const { name, artifact } of input.charts) {
      if (
        artifact.kind !== "chart" ||
        artifact.component !== `chart:${name}` ||
        !/^2\.0\.0-\d+$/u.test(artifact.version) ||
        artifact.uri !==
          `https://chartmuseum.tailnet-1a49.ts.net/charts/${name}-${artifact.version}.tgz`
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Root release accepts only exact qualified repository chart artifacts",
        });
      }
    }
  });

export function verifyRootJobResult(
  raw: unknown,
  input: z.infer<typeof RootReleaseInputSchema>,
) {
  const root = input.charts.find(({ name }) => name === "apps");
  if (root === undefined)
    throw new Error("Root receipt lacks its exact apps chart");
  const result = z
    .object({
      schema: z.literal("homelab-release-result/v1"),
      outcome: z.literal("applied-verified"),
      rootApplication: z.literal("apps"),
      requestId: z.literal(input.requestId),
      revision: z.literal(root.artifact.version),
      terminalOperationState: z.literal("terminated-after-applied"),
      finalHealth: z.literal("all-expected-child-applications-synced-healthy"),
      resourceIdentities: z.array(z.string()).min(1),
      applications: z.array(
        z.object({ name: z.string(), revision: z.string() }),
      ),
    })
    .strict()
    .parse(raw);
  const actual = result.applications
    .map(({ name, revision }) => `${name}@${revision}`)
    .sort();
  const expected = input.charts
    .map(({ name, artifact }) => `${name}@${artifact.version}`)
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      "Root release native receipt differs from the frozen exact inventory",
    );
}

export async function run(
  request: DeliveryJobRequest,
  admit: () => Promise<unknown> = async () =>
    await admitPlatformNativeJob(request),
): Promise<unknown> {
  const input = RootReleaseInputSchema.parse(request.input);
  // Verify every referenced archive before invoking the existing exact-revision,
  // lifecycle, prune, immutable-field and request-ownership preflight.
  for (const { artifact } of input.charts) {
    const response = await fetch(artifact.uri, {
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        `Root release chart inspection returned HTTP ${response.status.toString()}`,
      );
    const digest = `sha256:${createHash("sha256")
      .update(new Uint8Array(await response.arrayBuffer()))
      .digest("hex")}`;
    if (digest !== artifact.digest)
      throw new Error(
        "Root release chart bytes differ from the frozen inventory",
      );
  }
  const directory = await mkdtemp(
    path.join(tmpdir(), "delivery-root-release-"),
  );
  try {
    const root = path.resolve(import.meta.dirname, "../../../..");
    const resultPath = path.join(root, HOMELAB_RELEASE_RESULT_FILE);
    const resultFile = Bun.file(resultPath);
    if (await resultFile.exists())
      throw new Error(
        "Fresh root Job checkout already contains an unowned release receipt",
      );
    const inventoryPath = path.join(directory, "expected.json");
    const inventory = input.charts.map(({ name, artifact }) => ({
      name,
      revision: artifact.version,
      prune: releasePrunesChart(name),
    }));
    await writeFile(inventoryPath, JSON.stringify(inventory));
    const selected = input.charts.find(({ name }) => name === "apps");
    if (selected === undefined) throw new Error("Frozen root chart is missing");
    const server = Bun.env["ARGOCD_SERVER_URL"];
    if (server !== undefined && server !== "https://argocd.sjer.red")
      throw new Error("Root Job Argo server differs from its fixed recipe");
    // The canonical library repeats this same PG/native admission at stage,
    // child reconciliation and finalization. Recovery injects admit-apply here.
    await releaseRoot(
      "apps",
      inventoryPath,
      selected.artifact.version,
      input.requestId,
      300,
      false,
      {
        requestId: input.requestId,
        revision: selected.artifact.version,
        inventory,
        authorize: admit,
      },
      resultPath,
    );
    verifyRootJobResult(await Bun.file(resultPath).json(), input);
    return {
      requestId: input.requestId,
      charts: input.charts.map(({ name, artifact }) => ({
        name,
        revision: artifact.version,
      })),
      outcome: "applied-verified",
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
