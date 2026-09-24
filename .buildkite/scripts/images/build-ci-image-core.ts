import { asRecord } from "../../../scripts/lib/json.ts";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname.replace(
  /\/$/,
  "",
);

export type CiImageName =
  | "ci-base"
  | "ci-playwright"
  | "windows-cross-compiler"
  | "windows-cross-compiler-winui";

export type CiImageDefinition = {
  readonly name: CiImageName;
  readonly repository: string;
  readonly dockerfile: string;
  readonly digestFile: string;
  readonly stateFile: string;
  readonly branch: string;
  readonly sourceFiles: readonly string[];
  /** Dockerfile stage to publish; the final stage when absent. */
  readonly target?: string;
  /** Build platform; the builder's native platform when absent. */
  readonly platform?: string;
};

const WINDOWS_CROSS_COMPILER_ROOT = "packages/windows-cross-compiler";

/** Tracked files under a repository directory, in a stable order. */
function repositoryFiles(directory: string): readonly string[] {
  return [
    ...new Bun.Glob("**/*").scanSync({
      cwd: `${REPO_ROOT}/${directory}`,
      onlyFiles: true,
    }),
  ]
    .map((file) => `${directory}/${file}`)
    .sort();
}

function windowsCrossCompilerSources(): readonly string[] {
  return [
    `${WINDOWS_CROSS_COMPILER_ROOT}/Dockerfile`,
    ...repositoryFiles(`${WINDOWS_CROSS_COMPILER_ROOT}/bin`),
    ...repositoryFiles(`${WINDOWS_CROSS_COMPILER_ROOT}/msbuild`),
    ...repositoryFiles(`${WINDOWS_CROSS_COMPILER_ROOT}/wine-patches`),
  ];
}

export function ciImageDefinition(name: string): CiImageDefinition {
  switch (name) {
    case "ci-base":
      return {
        name,
        repository: "ghcr.io/shepherdjerred/ci-base",
        dockerfile: ".buildkite/ci-image/Dockerfile",
        digestFile: ".buildkite/ci-image/DIGEST",
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
    case "windows-cross-compiler":
    case "windows-cross-compiler-winui":
      return {
        name,
        repository: `ghcr.io/shepherdjerred/${name}`,
        dockerfile: `${WINDOWS_CROSS_COMPILER_ROOT}/Dockerfile`,
        digestFile: `${WINDOWS_CROSS_COMPILER_ROOT}/images/${name}/DIGEST`,
        stateFile: `${WINDOWS_CROSS_COMPILER_ROOT}/images/${name}/STATE.json`,
        branch: `chore/${name}-pin-pending`,
        sourceFiles: windowsCrossCompilerSources(),
        target: name === "windows-cross-compiler" ? "base" : "winui",
        platform: "linux/amd64",
      };
    default:
      throw new Error(`Unknown CI image ${name}`);
  }
}

export type CiImageCandidate = {
  readonly schema: "ci-image-candidate/v1";
  readonly image: CiImageName;
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
  definition: CiImageDefinition,
  sourceFingerprint: string,
  metadataFile: string,
): readonly string[] {
  const { repository: image, dockerfile, target, platform } = definition;
  return [
    "docker",
    "buildx",
    "build",
    "--builder",
    "ci",
    "--file",
    dockerfile,
    ...(target === undefined ? [] : ["--target", target]),
    ...(platform === undefined ? [] : ["--platform", platform]),
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

/**
 * Solves a self-test report stage against the remote builder and exports the
 * report locally: the build fails if a check fails. Reads the published
 * images' build caches and never writes them or pushes an image.
 */
export function ciImageSelftestCommand(
  definitions: readonly CiImageDefinition[],
  target: string,
  outputDirectory: string,
): readonly string[] {
  const [first] = definitions;
  if (first === undefined) {
    throw new Error("A self-test needs at least one image definition");
  }
  const { dockerfile, platform } = first;
  for (const definition of definitions) {
    if (
      definition.dockerfile !== dockerfile ||
      definition.platform !== platform
    ) {
      throw new Error(
        `${definition.name} does not share ${first.name}'s Dockerfile and platform`,
      );
    }
  }
  return [
    "docker",
    "buildx",
    "build",
    "--builder",
    "ci",
    "--file",
    dockerfile,
    "--target",
    target,
    ...(platform === undefined ? [] : ["--platform", platform]),
    ...definitions.flatMap((definition) => [
      "--cache-from",
      `type=registry,ref=${definition.repository}:buildcache`,
    ]),
    "--output",
    `type=local,dest=${outputDirectory}`,
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
