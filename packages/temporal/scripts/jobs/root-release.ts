import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import { releasePrunesChart } from "homelab/scripts/helm/helm-release-core.ts";
import { z } from "zod";

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

export async function run(raw: unknown): Promise<unknown> {
  const input = RootReleaseInputSchema.parse(raw);
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
    const child = Bun.spawn(rootReleaseCommand(input, inventoryPath), {
      cwd: path.resolve(import.meta.dirname, "../../../.."),
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
