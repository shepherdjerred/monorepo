import { fail } from "./validate-pipeline-parse.ts";
import {
  requireAllPresent,
  requireNonePresent,
} from "./validate-pipeline-lib.ts";
import { APPLICATION_IMAGE_TARGETS } from "./image-targets.ts";
import { assertMonorepoSourceLabel } from "./docker-source-label.ts";
import { productionBakeEnvironment } from "./production-bake-environment.ts";
import { asRecord } from "../../scripts/lib/json.ts";

type SmokePort = {
  readonly image: string;
  readonly port: number;
};

const COMMON_WORKSPACE_PATHS = [
  /^packages\/[^/]+$/u,
  /^packages\/[^/]+\/packages\/[^/]+$/u,
] as const;

export function explicitWorkspaceManifests(
  workspacePaths: readonly string[],
): string[] {
  return workspacePaths
    .filter(
      (workspacePath) =>
        !COMMON_WORKSPACE_PATHS.some((pattern) => pattern.test(workspacePath)),
    )
    .map((workspacePath) => `${workspacePath}/package.json`)
    .sort();
}

export function assertWorkspaceInstallContexts(
  dockerfile: string,
  image: string,
  explicitManifests: readonly string[],
): void {
  const lines = dockerfile.split("\n");
  let stage = "unnamed-stage";

  for (const [lineIndex, line] of lines.entries()) {
    const stageMatch = /^FROM .+\sAS\s+(\S+)$/iu.exec(line);
    if (stageMatch?.[1] !== undefined) {
      stage = stageMatch[1];
    }
    if (!/^RUN bun install --frozen-lockfile\b/u.test(line)) {
      continue;
    }

    let copyStart = lineIndex - 1;
    while (
      copyStart >= 0 &&
      !/^COPY --parents\b/u.test(lines[copyStart] ?? "") &&
      !/^FROM\b/u.test(lines[copyStart] ?? "")
    ) {
      copyStart--;
    }
    const copyStartLine = lines[copyStart];
    if (
      copyStartLine === undefined ||
      copyStart < 0 ||
      !/^COPY --parents\b/u.test(copyStartLine)
    ) {
      fail(`${image} ${stage} frozen install has no manifest COPY context`);
    }

    const copyBlock = lines.slice(copyStart, lineIndex).join("\n");
    const missingManifests = explicitManifests.filter(
      (manifest) => !copyBlock.includes(manifest),
    );
    if (missingManifests.length > 0) {
      fail(
        [
          `${image} ${stage} frozen install is missing workspace manifests:`,
          ...missingManifests.map((manifest) => `- ${manifest}`),
        ].join("\n"),
      );
    }
  }
}

export function assertWikiManifestInDockerContext(dockerignore: string): void {
  const rules = new Set(dockerignore.split("\n").map((line) => line.trim()));
  for (const required of [
    "packages/docs/*",
    "!packages/docs/wiki",
    "packages/docs/wiki/*",
    "!packages/docs/wiki/package.json",
  ]) {
    if (!rules.has(required)) {
      fail(
        `.dockerignore is missing wiki workspace manifest context rule ${required}`,
      );
    }
  }
}

type ResolvedBakeTarget = {
  readonly dockerfilePath: string;
  readonly publishedStage: string;
};

export function resolvedBakeTarget(
  bake: unknown,
  image: string,
): ResolvedBakeTarget {
  const targets = asRecord(asRecord(bake)?.["target"]);
  const target = asRecord(targets?.[image]);
  const dockerfilePath = target?.["dockerfile"];
  const publishedStage = target?.["target"];
  if (typeof dockerfilePath !== "string" || dockerfilePath.length === 0) {
    fail(`resolved Bake target ${image} has no Dockerfile`);
  }
  if (typeof publishedStage !== "string" || publishedStage.length === 0) {
    fail(`resolved Bake target ${image} has no published stage`);
  }
  return { dockerfilePath, publishedStage };
}

async function printResolvedBake(): Promise<unknown> {
  const child = Bun.spawn(
    ["docker", "buildx", "bake", "--print", ...APPLICATION_IMAGE_TARGETS],
    {
      env: productionBakeEnvironment(Bun.env, {
        version: "validation",
        gitSha: "validation",
        contractHash: "validation",
      }),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    fail(`docker buildx bake --print failed: ${stderr.trim()}`);
  }
  try {
    const value: unknown = JSON.parse(stdout);
    return value;
  } catch (error) {
    fail(`docker buildx bake --print returned invalid JSON: ${String(error)}`);
  }
}

async function assertApplicationSourceLabels(
  resolvedTargets: Readonly<Record<string, ResolvedBakeTarget>>,
): Promise<void> {
  for (const image of APPLICATION_IMAGE_TARGETS) {
    const target = resolvedTargets[image];
    if (target === undefined) fail(`resolved Bake target ${image} is missing`);
    assertMonorepoSourceLabel(
      await Bun.file(target.dockerfilePath).text(),
      image,
      target.publishedStage,
    );
  }
}

function smokeStage(dockerfile: string, image: string): string {
  const marker = /^FROM .+ AS smoke$/m.exec(dockerfile);
  if (marker?.index === undefined) {
    fail(`${image} Dockerfile has no smoke stage`);
  }
  const remainder = dockerfile.slice(marker.index + marker[0].length);
  const nextStage = remainder.search(/^FROM /m);
  return nextStage === -1 ? remainder : remainder.slice(0, nextStage);
}

export function explicitSmokePort(
  dockerfile: string,
  image: string,
  variable: string,
): SmokePort {
  if (!/^[A-Z_]+$/.test(variable)) {
    fail(`invalid smoke port variable ${variable}`);
  }
  const stage = smokeStage(dockerfile, image);
  const exports = stage.matchAll(/\bexport\s+([A-Z_]+)=:?([1-9]\d{0,4});/g);
  const rawPort = exports.find((match) => match[1] === variable)?.[2];
  if (rawPort === undefined) {
    fail(`${image} smoke must export an explicit ${variable}`);
  }
  const port = Number.parseInt(rawPort, 10);
  if (port > 65_535) {
    fail(`${image} smoke port ${rawPort} is outside the TCP port range`);
  }
  return { image, port };
}

export function httpSmokePort(dockerfile: string, image: string): SmokePort {
  const stage = smokeStage(dockerfile, image);
  const rawPort = /http:\/\/127\.0\.0\.1:([1-9]\d{0,4})/.exec(stage)?.[1];
  if (rawPort === undefined) {
    fail(`${image} smoke has no explicit loopback HTTP port`);
  }
  return { image, port: Number.parseInt(rawPort, 10) };
}

export function assertUniqueSmokePorts(ports: readonly SmokePort[]): void {
  const owners = new Map<number, string>();
  for (const { image, port } of ports) {
    const owner = owners.get(port);
    if (owner !== undefined) {
      fail(
        `${image} and ${owner} smoke stages both bind port ${port.toString()} during parallel bake`,
      );
    }
    owners.set(port, image);
  }
}

export function applicationSmokePort(source: string, image: string): SmokePort {
  const marker = `  "${image}": {`;
  const start = source.indexOf(marker);
  if (start === -1) {
    fail(`${image} application smoke configuration is missing`);
  }
  const next = source.indexOf('\n  "', start + marker.length);
  const block = source.slice(start, next === -1 ? source.length : next);
  const rawPort = /PORT: "([1-9]\d{0,4})"/.exec(block)?.[1];
  if (rawPort === undefined) {
    fail(`${image} application smoke must set an explicit PORT`);
  }
  return { image, port: Number.parseInt(rawPort, 10) };
}

export async function validateImageMigrationContracts(
  pipeline: string,
  bakeImages: string,
): Promise<void> {
  if (bakeImages.includes("ALWAYS_ON_TARGETS")) {
    fail("bake-images.ts restored the always-on image target workaround");
  }
  requireAllPresent(
    bakeImages,
    [
      '"docker"',
      '"buildx"',
      '"bake"',
      '"--builder"',
      '"ci"',
      "CADDYFILE_SMOKE_PATH",
    ],
    (required) =>
      `bake-images.ts is missing production image contract ${required}`,
  );
  requireNonePresent(
    bakeImages,
    ["CI_BUILDX_", "--target", "image-build-manifest"],
    (forbidden) =>
      `bake-images.ts retained rejected Buildx experiment ${forbidden}`,
  );
  for (const forbidden of ["--load", "DOCKER_HOST", "docker:28-dind"]) {
    if (pipeline.includes(forbidden) || bakeImages.includes(forbidden)) {
      fail(`CI retained forbidden Docker-in-Docker path ${forbidden}`);
    }
  }

  const dockerBake = await Bun.file("docker-bake.hcl").text();
  if (dockerBake.includes('variable "READ_CACHE"')) {
    fail("docker-bake.hcl retained the rejected Buildx experiment cache mode");
  }
  assertWikiManifestInDockerContext(await Bun.file(".dockerignore").text());
  const rootPackage = asRecord(await Bun.file("package.json").json());
  const rawWorkspaces = rootPackage?.["workspaces"];
  if (!Array.isArray(rawWorkspaces)) {
    fail("root package.json workspaces must be an array");
  }
  const workspacePaths: string[] = [];
  for (const workspacePath of rawWorkspaces) {
    if (typeof workspacePath !== "string") {
      fail("root package.json workspaces must contain only strings");
    }
    workspacePaths.push(workspacePath);
  }
  const requiredManifests = explicitWorkspaceManifests(workspacePaths);
  const resolvedBake = await printResolvedBake();
  const resolvedTargets: Record<string, ResolvedBakeTarget> = {};
  const appDockerfiles = new Set<string>();
  for (const image of APPLICATION_IMAGE_TARGETS) {
    const target = resolvedBakeTarget(resolvedBake, image);
    resolvedTargets[image] = target;
    appDockerfiles.add(target.dockerfilePath);
  }
  if (appDockerfiles.size === 0) {
    fail("docker-bake.hcl contains no app Dockerfiles");
  }
  for (const dockerfilePath of appDockerfiles) {
    assertWorkspaceInstallContexts(
      await Bun.file(dockerfilePath).text(),
      dockerfilePath,
      requiredManifests,
    );
  }
  await assertApplicationSourceLabels(resolvedTargets);

  const buildCiImage = await Bun.file(
    ".buildkite/scripts/build-ci-image.ts",
  ).text();
  const buildCiImageCore = await Bun.file(
    ".buildkite/scripts/build-ci-image-core.ts",
  ).text();
  const buildCiImageContract = `${buildCiImage}\n${buildCiImageCore}`;
  if (
    !buildCiImageContract.includes(
      "tcp://buildkitd-buildkitd-service.buildkitd.svc.cluster.local:1234",
    ) ||
    !buildCiImageContract.includes('"--builder"') ||
    !buildCiImageContract.includes('"ci"')
  ) {
    fail("build-ci-image.ts must use the remote production BuildKit builder");
  }

  const caddyCheck = await Bun.file(
    "packages/homelab/src/cdk8s/scripts/check-caddyfile.ts",
  ).text();
  requireNonePresent(
    caddyCheck,
    ['"docker"', "caddy-s3proxy:dev", "docker buildx", "imageExists"],
    (hiddenBuild) =>
      `check-caddyfile.ts restored hidden build path ${hiddenBuild}`,
  );

  const caddyDockerfile = await Bun.file(
    "packages/homelab/images/caddy-s3proxy/Dockerfile",
  ).text();
  requireAllPresent(
    caddyDockerfile,
    [
      "FROM runtime AS smoke",
      "--mount=type=secret,id=caddyfile",
      "caddy adapt --config /run/secrets/caddyfile --adapter caddyfile",
    ],
    (required) => `Caddy in-image smoke is missing contract ${required}`,
  );

  const redlibDockerfile = await Bun.file(
    "packages/homelab/images/redlib/Dockerfile",
  ).text();
  const applicationSmoke = await Bun.file(
    ".buildkite/scripts/smoke-app-in-image.ts",
  ).text();
  const tasknotesPort = applicationSmokePort(
    applicationSmoke,
    "tasknotes-server",
  );
  const trmnlPort = applicationSmokePort(applicationSmoke, "trmnl-dashboard");
  const scoutPort = applicationSmokePort(applicationSmoke, "scout-for-lol");
  requireAllPresent(
    applicationSmoke,
    [`listening on :${trmnlPort.port.toString()}`],
    (required) =>
      `trmnl-dashboard smoke listener and readiness check disagree: missing ${required}`,
  );
  assertUniqueSmokePorts([
    httpSmokePort(redlibDockerfile, "redlib"),
    tasknotesPort,
    trmnlPort,
    scoutPort,
  ]);
}
