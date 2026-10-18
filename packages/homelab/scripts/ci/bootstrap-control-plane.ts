import path from "node:path";
import { z } from "zod";
import { run } from "@shepherdjerred/root-scripts/lib/run.ts";
import { canonicalJson } from "#scripts/canonical-json.ts";

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const Artifact = z.strictObject({
  id: z.string().min(1),
  buildId: z.string().min(1),
  serviceId: z.string(),
  component: z.string(),
  kind: z.enum(["image", "chart"]),
  uri: z.string(),
  digest: Digest,
  version: z.string().regex(/^2\.0\.0-\d+$/u),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/u),
  createdAt: z.iso.datetime(),
  runtimeDigests: z.array(Digest),
  requires: z.record(z.string(), Digest),
  origin: z.strictObject({ kind: z.literal("first-party") }),
});
export const BootstrapControlPlaneSchema = z
  .strictObject({ image: Artifact, chart: Artifact })
  .superRefine((value, context) => {
    const { image, chart } = value;
    if (
      image.serviceId !== "temporal" ||
      image.component !== "image:temporal-worker" ||
      image.kind !== "image" ||
      image.uri !== "docker.io/shepherdjerred/temporal-worker" ||
      chart.serviceId !== "delivery-control-plane" ||
      chart.component !== "chart:delivery-control-plane" ||
      chart.kind !== "chart" ||
      chart.uri !==
        `https://chartmuseum.tailnet-1a49.ts.net/charts/delivery-control-plane-${chart.version}.tgz`
    )
      context.addIssue({
        code: "custom",
        message:
          "Bootstrap control plane requires its original fixed CI artifact owners",
      });
    const selected = new Map([
      [image.component, image.digest],
      [chart.component, chart.digest],
    ]);
    for (const artifact of [image, chart])
      for (const [component, digest] of Object.entries(artifact.requires))
        if (selected.get(component) !== digest)
          context.addIssue({
            code: "custom",
            message: "Original control-plane artifacts are not compatible",
          });
  });
export type BootstrapControlPlane = z.infer<typeof BootstrapControlPlaneSchema>;

/** Only the existing authenticated verifier can establish qualification; descriptor fields never grant eligibility. */
export async function verifyBootstrapControlPlane(
  selection: BootstrapControlPlane | undefined,
  directory: string,
  read = async (query: unknown, name: string): Promise<unknown> => {
    const file = path.join(directory, `qualified-${name}.json`);
    await Bun.write(file, JSON.stringify(query) + "\n", { mode: 0o600 });
    const result = await run(
      [
        "toolkit",
        "deploy",
        "artifact",
        "--file",
        file,
        "--machine",
        "--url",
        "https://delivery.tailnet-1a49.ts.net",
        "--json",
      ],
      { capture: true, echoCapturedStdout: false },
    );
    return JSON.parse(result.stdout);
  },
) {
  if (selection === undefined) return;
  const frozen = BootstrapControlPlaneSchema.parse(selection);
  for (const [name, artifact] of Object.entries(frozen)) {
    const observed = Artifact.parse(
      await read(
        {
          serviceId: artifact.serviceId,
          component: artifact.component,
          kind: artifact.kind,
          digest: artifact.digest,
          version: artifact.version,
          originKind: "first-party",
        },
        name,
      ),
    );
    if (canonicalJson(observed) !== canonicalJson(artifact))
      throw new Error(
        "Original qualified control-plane identity differs from bootstrap selection",
      );
  }
}

export async function verifyBootstrapControlPlaneArchive(
  selection: BootstrapControlPlane | undefined,
  transport: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response> = fetch,
) {
  if (selection === undefined) return;
  const response = await transport(selection.chart.uri, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || response.body === null)
    throw new Error(
      "Cannot inspect original qualified control-plane chart bytes",
    );
  const hasher = new Bun.CryptoHasher("sha256");
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const value = z.instanceof(Uint8Array).parse(result.value);
      size += value.byteLength;
      if (size > 32 * 1024 * 1024)
        throw new Error("Original control-plane chart exceeds bootstrap bound");
      hasher.update(value);
    }
  } finally {
    await reader.cancel();
  }
  if (`sha256:${hasher.digest("hex")}` !== selection.chart.digest)
    throw new Error(
      "Original control-plane chart differs from its qualified digest",
    );
}
