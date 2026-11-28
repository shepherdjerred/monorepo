import path from "node:path";
import { z } from "zod";
import {
  EXEMPTIONS,
  loadRegistrationInputs,
  resolveImmutableRevisionBase,
  type Finding,
  type RegistrationInputs,
} from "./service-registration.ts";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..");
const IMAGE_REGISTRY = "packages/version-catalog/src/image-registry.json";
const IMAGE_TARGETS = "ci/scripts/images/image-targets.ts";
const DOCKERHUB_TF = "packages/homelab/src/tofu/dockerhub/main.tf.json";

const ImageRegistrySchema = z.looseObject({
  images: z.array(
    z.looseObject({
      name: z.string(),
      visibility: z.enum(["private", "public"]).optional(),
    }),
  ),
});

const DockerhubStackSchema = z.looseObject({
  locals: z.looseObject({
    registry: ImageRegistrySchema,
  }),
});

function runGit(
  root: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): { exitCode: number; stdout: string } {
  const res = Bun.spawnSync(["git", ...args], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: res.exitCode, stdout: res.stdout.toString("utf8") };
}

export async function privateImageProvisioningFindings(
  options: {
    root?: string;
    env?: Readonly<Record<string, string | undefined>>;
    inputs?: Pick<
      RegistrationInputs,
      | "privateRegistryImages"
      | "applicationTargets"
      | "infrastructureTargets"
      | "exemptions"
    >;
  } = {},
): Promise<Finding[]> {
  const root = options.root ?? REPOSITORY_ROOT;
  const env = options.env ?? Bun.env;
  const inputs = options.inputs ?? (await loadRegistrationInputs(root));
  const privateImages = inputs.privateRegistryImages ?? new Set<string>();
  const findings: Finding[] = [];

  const dockerhubFile = Bun.file(path.join(root, DOCKERHUB_TF));
  if (await dockerhubFile.exists()) {
    const tf = DockerhubStackSchema.parse(
      JSON.parse(await dockerhubFile.text()),
    );
    const tfPrivate = new Set(
      tf.locals.registry.images
        .filter((img) => img.visibility === "private")
        .map((img) => img.name),
    );
    for (const img of Object.keys(inputs.exemptions.pendingPrivateImages)) {
      if (privateImages.has(img) && !tfPrivate.has(img)) {
        findings.push({
          subject: img,
          item: `image:${img}: ${DOCKERHUB_TF} is missing private repository "${img}"; run \`bun run --cwd packages/homelab-cdktn synth\``,
        });
      }
    }
  }

  const base = resolveImmutableRevisionBase(root, env);
  if (base === undefined) return findings;
  const blob = runGit(root, ["show", `${base}:${IMAGE_REGISTRY}`], env);
  if (blob.exitCode !== 0) return findings;
  const baseRegistry = ImageRegistrySchema.parse(JSON.parse(blob.stdout));
  const basePrivate = new Set(
    baseRegistry.images
      .filter((img) => img.visibility === "private")
      .map((img) => img.name),
  );
  for (const img of [...privateImages].toSorted()) {
    if (basePrivate.has(img)) continue;
    if (
      inputs.applicationTargets.has(img) ||
      inputs.infrastructureTargets.has(img)
    ) {
      findings.push({
        subject: img,
        item: `image:${img}: newly added private image in ${IMAGE_REGISTRY} cannot add a build target in ${IMAGE_TARGETS} in the same PR (bake pushes before tofu-dockerhub creates the private repo); land ${IMAGE_REGISTRY}, ${DOCKERHUB_TF} (\`bun run --cwd packages/homelab-cdktn synth\`), and pendingPrivateImages["${img}"] in ${EXEMPTIONS} in a pre-provisioning PR first`,
      });
    }
  }
  return findings;
}
