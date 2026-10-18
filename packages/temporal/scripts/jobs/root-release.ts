import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import { releasePrunesChart } from "homelab/scripts/helm/helm-release-core.ts";
import { z } from "zod";
import { HOMELAB_RELEASE_RESULT_FILE } from "homelab/scripts/argocd/argocd-release-result.ts";
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

export function rootReleaseCommand(
  raw: unknown,
  inventoryPath: string,
): string[] {
  const input = RootReleaseInputSchema.parse(raw);
  const root = input.charts.find((chart) => chart.name === "apps");
  if (root === undefined)
    throw new Error("Root chart missing from validated inventory");
  return [
    "bun",
    "--no-install",
    "packages/homelab/scripts/argocd/argocd.ts",
    "release-root",
    "apps",
    inventoryPath,
    "--revision",
    root.artifact.version,
    "--request-id",
    input.requestId,
  ];
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
    const resultFile = Bun.file(path.join(root, HOMELAB_RELEASE_RESULT_FILE));
    if (await resultFile.exists())
      throw new Error(
        "Fresh root Job checkout already contains an unowned release receipt",
      );
    const inventoryPath = path.join(directory, "expected.json");
    await writeFile(
      inventoryPath,
      JSON.stringify(
        input.charts.map(({ name, artifact }) => ({
          name,
          revision: artifact.version,
          prune: releasePrunesChart(name),
        })),
      ),
    );
    await admit();
    const child = Bun.spawn(rootReleaseCommand(input, inventoryPath), {
      cwd: root,
      env: {
        PATH: Bun.env["PATH"],
        HOME: Bun.env["HOME"],
        TMPDIR: Bun.env["TMPDIR"],
        ARGOCD_TOKEN: Bun.env["ARGOCD_TOKEN"],
        ARGOCD_SERVER_URL: "https://argocd.sjer.red",
      },
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await child.exited;
    if (code !== 0)
      throw new Error(
        `Guarded root release failed with exit ${code.toString()}; inspect its recorded request before retrying`,
      );
    verifyRootJobResult(await resultFile.json(), input);
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
