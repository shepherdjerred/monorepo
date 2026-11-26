import nodePath from "node:path";
import type {
  RankedRenovateUpdate,
  RenovateTarget,
} from "@shepherdjerred/ops-model/renovate-ranking.ts";
import { isSafeRelativeRepoPath } from "#activities/remediation/codex-pr-remediation-git.ts";

const { posix } = nodePath;

const DEPENDENCY_FIELDS = new Set([
  "catalog",
  "catalogs",
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "overrides",
  "peerDependencies",
  "resolutions",
]);

export type BundleLane =
  "bun" | "report" | "cargo" | "go" | "python" | "dotnet" | "repo";

export function isSafeBundlePath(file: string): boolean {
  return (
    isSafeRelativeRepoPath(file) &&
    !file.includes("\\") &&
    !file.includes(":") &&
    !file.includes("\n") &&
    !file
      .split("/")
      .some(
        (part) => part === "" || part === "." || part.toLowerCase() === ".git",
      )
  );
}

function isReportRenderer(target: RenovateTarget): boolean {
  return (
    target.packageName === "satori" &&
    /^packages\/scout-for-lol\/packages\/(?:report|design-system)\//u.test(
      target.filePath,
    )
  );
}

export function requiredUpgradeProof(
  target: RenovateTarget,
): string | undefined {
  const { filePath, packageName } = target;
  if (!isSafeBundlePath(filePath)) {
    return "Renovate reported an invalid repository path.";
  }
  if (
    /^(?:siderolabs\/|ghcr\.io\/siderolabs\/|kubernetes\/kubernetes$)/u.test(
      packageName,
    )
  ) {
    return "Follow the Talos and Kubernetes live upgrade procedure.";
  }
  if (/^shepherdjerred\/.+\/prod$/u.test(packageName)) {
    return "Follow the dedicated production promotion procedure.";
  }
  if (/^gpui-(?:kit|pre)(?:$|-)/u.test(packageName)) {
    return "Scout Desktop requires the dedicated gpui upgrade and Windows verification.";
  }
  if (
    /^(?:Microsoft\.WindowsAppSDK|Microsoft\.Windows\.SDK\.)/iu.test(
      packageName,
    )
  ) {
    return "A native Windows build and packaging verification are required.";
  }
  if (filePath.startsWith(".github/")) {
    return "Updating GitHub workflow definitions requires the dedicated workflow-write permission.";
  }
  if (/(?:^|\/)(?:Dockerfile|[^/]+\.Dockerfile)$/u.test(filePath)) {
    return "An image build and the affected image's smoke verification are required.";
  }
  if (target.manager === "swift" || /(?:^|\/)Package\.swift$/u.test(filePath)) {
    return "Verify this update with the repository's macOS Swift toolchain.";
  }
  if (
    /^packages\/homelab\/.*(?:\.tf(?:\.json)?|\.terraform\.lock\.hcl)$/u.test(
      filePath,
    )
  ) {
    return "Run the corresponding OpenTofu plan through the homelab procedure.";
  }
  return packageName.toLowerCase() === "trivy" && filePath.startsWith("ci/")
    ? "Use the dedicated CI scanner upgrade and image verification."
    : undefined;
}

function targetLane(target: RenovateTarget): BundleLane {
  if (isReportRenderer(target)) return "report";
  if (target.manager === "npm" || target.filePath.endsWith("package.json"))
    return "bun";
  if (target.manager === "cargo") return "cargo";
  if (target.manager === "gomod") return "go";
  if (target.manager === "nuget" || target.manager === "dotnet-version")
    return "dotnet";
  return ["pep621", "pip_requirements", "pip-compile", "poetry", "uv"].includes(
    target.manager,
  )
    ? "python"
    : "repo";
}

export function bundleLanes(
  candidate: Pick<RankedRenovateUpdate, "targets">,
): Set<BundleLane> {
  const lanes = new Set(candidate.targets.map((target) => targetLane(target)));
  if (lanes.has("report")) lanes.delete("bun");
  return lanes;
}

export function canBundleTogether(
  left: RankedRenovateUpdate,
  right: RankedRenovateUpdate,
): boolean {
  const leftLanes = bundleLanes(left);
  const rightLanes = bundleLanes(right);
  return (
    leftLanes.size === rightLanes.size &&
    [...leftLanes].every((lane) => rightLanes.has(lane)) &&
    !left.targets.some((target) =>
      right.targets.some(
        (other) =>
          target.filePath === other.filePath &&
          target.packageName === other.packageName,
      ),
    )
  );
}

function nearestTrackedFile(
  target: string,
  name: string,
  trackedPaths: ReadonlySet<string>,
): string | undefined {
  let dir = posix.dirname(target);
  for (;;) {
    const file = posix.join(dir, name);
    if (trackedPaths.has(file)) return file;
    if (dir === ".") return undefined;
    dir = posix.dirname(dir);
  }
}

export function targetArtifactPaths(
  target: RenovateTarget,
  trackedPaths: ReadonlySet<string>,
): string[] {
  const lane = targetLane(target);
  if (lane === "report") {
    return [
      "bun.lock",
      "packages/scout-for-lol/packages/report/visual-contract/manifest.json",
    ];
  }
  if (lane === "bun") return ["bun.lock"];
  if (lane === "cargo" || lane === "go" || lane === "python") {
    const lock =
      lane === "cargo" ? "Cargo.lock" : lane === "go" ? "go.sum" : "uv.lock";
    const path = nearestTrackedFile(target.filePath, lock, trackedPaths);
    return path === undefined ? [] : [path];
  }
  if (lane === "dotnet") {
    const root = posix.dirname(target.filePath);
    const prefix = root === "." ? "" : `${root}/`;
    return [...trackedPaths].filter(
      (file) => file.startsWith(prefix) && file.endsWith("/packages.lock.json"),
    );
  }
  return [];
}

export function candidateReservedPaths(
  candidate: RankedRenovateUpdate,
  trackedPaths: ReadonlySet<string>,
): Set<string> {
  return new Set(
    candidate.targets.flatMap((target) => [
      target.filePath,
      ...targetArtifactPaths(target, trackedPaths),
    ]),
  );
}

export function dependencyFields(
  manifest: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(manifest).filter(([key]) => DEPENDENCY_FIELDS.has(key)),
  );
}

export function allowedSourceExtension(file: string): boolean {
  return /\.(?:[cm]?[jt]sx?|rs|go|py|cs|css|svg|png|snap|md|mdx)$/u.test(file);
}

export function allowScopedSourcePath(
  file: string,
  roots: ReadonlySet<string>,
): boolean {
  return (
    isSafeBundlePath(file) &&
    !/^(?:ci|scripts|sandbox|\.agents|\.github)\//u.test(file) &&
    !/(?:^|\/)(?:AGENTS|CLAUDE|SKILL)\.md$|(?:^|\/)(?:eslint|vitest|vite|playwright)\.config\./u.test(
      file,
    ) &&
    allowedSourceExtension(file) &&
    [...roots].some((root) => file.startsWith(`${root}/`))
  );
}
