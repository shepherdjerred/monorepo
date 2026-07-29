import { asRecord } from "../../scripts/lib/json.ts";

const REPO_ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

export type CiImageName = "ci-base" | "ci-playwright";

export type CiImageDefinition = {
  readonly name: CiImageName;
  readonly repository: string;
  readonly dockerfile: string;
  readonly digestFile: string;
  readonly stateFile: string;
  readonly branch: string;
  readonly sourceFiles: readonly string[];
};

export function ciImageDefinition(name: string): CiImageDefinition {
  switch (name) {
    case "ci-base":
      return {
        name,
        repository: "ghcr.io/shepherdjerred/ci-base",
        dockerfile: ".buildkite/ci-image/Dockerfile",
        digestFile:
          "packages/homelab/src/cdk8s/src/resources/argo-applications/ci-base.DIGEST",
        stateFile: ".buildkite/ci-image/STATE.json",
        branch: "chore/ci-base-pin-pending",
        sourceFiles: [".buildkite/ci-image/Dockerfile", ".mise.toml"],
      };
    case "ci-playwright":
      return {
        name,
        repository: "ghcr.io/shepherdjerred/ci-playwright",
        dockerfile: ".buildkite/ci-playwright/Dockerfile",
        digestFile: ".buildkite/ci-playwright/DIGEST",
        stateFile: ".buildkite/ci-playwright/STATE.json",
        branch: "chore/ci-playwright-pin-pending",
        sourceFiles: [".buildkite/ci-playwright/Dockerfile"],
      };
    default:
      throw new Error(`Unknown CI image ${name}`);
  }
}

export type CiImageCandidate = {
  readonly schema: "ci-image-candidate/v1";
  readonly image: "ci-base" | "ci-playwright";
  readonly buildNumber: number;
  readonly sourceCommit: string;
  readonly sourceFingerprint: string;
  readonly digest: string;
};

export async function ciImageSourceFingerprint(
  definition: CiImageDefinition,
  readSource: (path: string) => Promise<Uint8Array | undefined> = async (
    path,
  ) => {
    const file = Bun.file(`${REPO_ROOT}/${path}`);
    return (await file.exists())
      ? new Uint8Array(await file.arrayBuffer())
      : undefined;
  },
): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const path of definition.sourceFiles) {
    const contents = await readSource(path);
    if (contents === undefined) {
      throw new Error(`CI image source file is missing: ${path}`);
    }
    hasher.update(path);
    hasher.update("\0");
    hasher.update(contents);
    hasher.update("\0");
  }
  return hasher.digest("hex");
}

export function builtImageDigest(metadata: unknown): string {
  const digest = asRecord(metadata)?.["containerimage.digest"];
  if (typeof digest !== "string" || !/^sha256:[\da-f]{64}$/.test(digest)) {
    throw new Error("Buildx metadata did not contain a canonical image digest");
  }
  return digest;
}

export function ciImageTags(
  image: string,
  sourceFingerprint: string,
): readonly string[] {
  return ["--tag", `${image}:candidate-${sourceFingerprint}`];
}

export const builderCreateCommand = [
  "docker",
  "buildx",
  "create",
  "--name",
  "ci",
  "--driver",
  "remote",
  "tcp://buildkitd-buildkitd-service.buildkitd.svc.cluster.local:1234",
] as const;

export function ciImageBuildCommand(
  image: string,
  dockerfile: string,
  sourceFingerprint: string,
  metadataFile: string,
): readonly string[] {
  return [
    "docker",
    "buildx",
    "build",
    "--builder",
    "ci",
    "--file",
    dockerfile,
    "--cache-from",
    `type=registry,ref=${image}:buildcache`,
    "--cache-to",
    `type=registry,ref=${image}:buildcache,mode=max,image-manifest=true`,
    "--metadata-file",
    metadataFile,
    ...ciImageTags(image, sourceFingerprint),
    "--push",
    ".",
  ];
}

export function registryLoginCommand(token?: string): string[] | undefined {
  return token === undefined || token.length === 0
    ? undefined
    : [
        "docker",
        "login",
        "ghcr.io",
        "-u",
        "shepherdjerred",
        "--password-stdin",
      ];
}
