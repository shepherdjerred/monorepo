import type { CiCommandStep, CiStep, StepVolume } from "#src/pipeline/model.ts";

/** Shared Bun cache claims created by the homelab manifests. */
export const BUN_CACHE = {
  claim: "woodpecker-bun-cache",
  path: "/woodpecker/bun-cache",
} as const satisfies StepVolume;

/** Separate lock storage shared with the Temporal cache collector. */
export const BUN_CACHE_CONTROL = {
  claim: "woodpecker-bun-cache-control",
  path: "/woodpecker/bun-cache-control",
} as const satisfies StepVolume;

/** UV cache claim created by the homelab manifests. */
export const UV_CACHE = {
  claim: "woodpecker-uv-cache",
  path: "/woodpecker/uv-cache",
} as const satisfies StepVolume;

/**
 * Toolchain caches that otherwise land in the container's home directory --
 * the writable layer on the CI node's OS disk -- and are rebuilt by every
 * step. Each claim is a separate ZFS dataset with its own quota, so one tool
 * filling its cache cannot starve another. None has a collector: Cargo, Go
 * and sccache bound or expire their own caches, and the homelab's
 * per-claim usage alert covers the rest.
 */

/** Cargo's crate registry and Git checkouts (`~/.cargo/{registry,git}`). */
export const CARGO_CACHE = {
  claim: "woodpecker-cargo-cache",
  path: "/woodpecker/cargo-cache",
} as const satisfies StepVolume;

/** sccache's compiled-object store for every rustc invocation. */
export const SCCACHE = {
  claim: "woodpecker-sccache",
  path: "/woodpecker/sccache",
} as const satisfies StepVolume;

/** Go's module download cache, build cache and golangci-lint cache. */
export const GO_CACHE = {
  claim: "woodpecker-go-cache",
  path: "/woodpecker/go-cache",
} as const satisfies StepVolume;

/**
 * Everything that follows the XDG cache convention (Prisma engines,
 * ffmpeg-static, mise), NuGet packages, and Bun's own install root for the
 * `bunx` invocations inside Turbo tasks.
 */
export const TOOL_CACHE = {
  claim: "woodpecker-tool-cache",
  path: "/woodpecker/tool-cache",
} as const satisfies StepVolume;

/**
 * Tool versions `ci/scripts/toolchain.sh` installs at runtime because the
 * pinned CI image lacks them, plus mise's download staging. Without this
 * claim every such install lands in `MISE_DATA_DIR=/opt/mise` -- the
 * container's writable layer on the CI node's OS disk -- once per pod for as
 * long as the image pin trails `.mise.toml`. Mounted only when the typed
 * `woodpecker-mise-shared-installs-enabled` flag is on.
 */
export const MISE_INSTALLS = {
  claim: "woodpecker-mise-installs",
  path: "/woodpecker/mise-installs",
} as const satisfies StepVolume;

/** The image's own installs; mise keeps resolving them while writing elsewhere. */
const IMAGE_MISE_INSTALLS = "/opt/mise/installs";

/** sccache evicts least-recently-used objects above this size. */
const SCCACHE_CACHE_SIZE = "30G";

type CacheEnvironment = Readonly<Record<string, string>>;

/**
 * Environment each mounted toolchain cache contributes. Tools read these
 * directly; the root turbo.json passes them through strict env mode so tasks
 * see the same locations as the step shell.
 */
const TOOLCHAIN_CACHE_ENVIRONMENT: readonly (readonly [
  StepVolume,
  CacheEnvironment,
])[] = [
  [
    UV_CACHE,
    {
      UV_CACHE_DIR: UV_CACHE.path,
      UV_PYTHON_INSTALL_DIR: `${UV_CACHE.path}/python`,
    },
  ],
  // Cargo has no variable for its download caches alone, and moving
  // CARGO_HOME would move the rustup-managed toolchain with it, so
  // ci/scripts/toolchain.sh links the two cache directories to this path.
  [CARGO_CACHE, { CI_CARGO_CACHE_DIR: CARGO_CACHE.path }],
  [
    SCCACHE,
    {
      RUSTC_WRAPPER: "sccache",
      SCCACHE_DIR: SCCACHE.path,
      SCCACHE_CACHE_SIZE,
      // sccache cannot cache incremental compilation, and a fresh workspace
      // has no incremental state to reuse anyway.
      CARGO_INCREMENTAL: "0",
    },
  ],
  [
    GO_CACHE,
    {
      GOMODCACHE: `${GO_CACHE.path}/mod`,
      GOCACHE: `${GO_CACHE.path}/build`,
      GOLANGCI_LINT_CACHE: `${GO_CACHE.path}/golangci-lint`,
    },
  ],
  [
    TOOL_CACHE,
    {
      XDG_CACHE_HOME: `${TOOL_CACHE.path}/xdg`,
      NUGET_PACKAGES: `${TOOL_CACHE.path}/nuget`,
      // Turbo strips BUN_INSTALL_CACHE_DIR from tasks on purpose: it names
      // the collected shared cache, whose readers must hold the collector's
      // lock. Tasks' `bunx` calls fall back to this root instead of ~/.bun.
      BUN_INSTALL: `${TOOL_CACHE.path}/bun`,
    },
  ],
  [
    MISE_INSTALLS,
    {
      // MISE_DATA_DIR stays /opt/mise so the image's shims keep working; only
      // new installs and their downloads move onto the claim. The shared
      // install dirs keep every version the image already carries resolvable,
      // so a stale image reinstalls exactly the versions it lacks. mise's own
      // lock files sit beside the destination, serializing pods on one node.
      MISE_INSTALLS_DIR: `${MISE_INSTALLS.path}/installs`,
      MISE_DOWNLOADS_DIR: `${MISE_INSTALLS.path}/downloads`,
      MISE_SHARED_INSTALL_DIRS: IMAGE_MISE_INSTALLS,
    },
  ],
];

function mountedAt(
  volumes: readonly StepVolume[] | undefined,
  declared: StepVolume,
): boolean {
  const mounted = volumes?.find((volume) => volume.claim === declared.claim);
  if (mounted !== undefined && mounted.path !== declared.path) {
    throw new Error(`${declared.claim} must use its declared mount path`);
  }
  return mounted !== undefined;
}

/**
 * Derive the environment that directs every tool at its mounted shared cache.
 *
 * The Bun cache and its control volume are a pair: mounting only one could
 * race cache cleanup or make every install fail to acquire its lock. Every
 * other cache is independent and contributes its variables only when mounted,
 * so an unmounted cache leaves the tool on its default location.
 */
export function sharedCacheEnvironment(
  volumes: readonly StepVolume[] | undefined,
): CacheEnvironment {
  let environment: CacheEnvironment = {};
  for (const [volume, contribution] of TOOLCHAIN_CACHE_ENVIRONMENT) {
    if (mountedAt(volumes, volume)) {
      environment = { ...environment, ...contribution };
    }
  }
  const cache = mountedAt(volumes, BUN_CACHE);
  const control = mountedAt(volumes, BUN_CACHE_CONTROL);
  if (cache !== control) {
    throw new Error(
      "Bun cache and cache control volumes must be mounted together",
    );
  }
  return cache
    ? {
        ...environment,
        BUN_INSTALL_CACHE_DIR: `${BUN_CACHE.path}/data`,
        BUN_INSTALL_LOCK_MODE: "shared",
        BUN_CACHE_LOCK_FILE: `${BUN_CACHE_CONTROL.path}/.gc.lock`,
      }
    : { ...environment, BUN_INSTALL_LOCK_MODE: "local" };
}

const BUN_INSTALL_WRAPPER = "ci/scripts/bun-install.sh";
const TOOLCHAIN_PREAMBLE = "ci/scripts/toolchain.sh";
const TOOLCHAIN_SCOPE_PREFIX = "MISE_TOOLCHAIN_SCOPE=";

/** Caches every toolchain-running container uses, whatever its scope. */
const COMMON_TOOL_CACHES: readonly StepVolume[] = [TOOL_CACHE];

/** Caches only the full toolchain scope (Rust, Go, Gradle, Python) fills. */
const FULL_TOOLCHAIN_CACHES: readonly StepVolume[] = [
  CARGO_CACHE,
  SCCACHE,
  GO_CACHE,
  UV_CACHE,
];

function withVolumes<T extends CiCommandStep>(
  command: T,
  additions: readonly StepVolume[],
): T {
  const missing = additions.filter(
    (addition) =>
      command.volumes?.some((volume) => volume.claim === addition.claim) !==
      true,
  );
  return missing.length === 0
    ? command
    : { ...command, volumes: [...(command.volumes ?? []), ...missing] };
}

function withBunCacheVolumes<T extends CiCommandStep>(command: T): T {
  return command.commands.some((line) => line.includes(BUN_INSTALL_WRAPPER))
    ? withVolumes(command, [BUN_CACHE, BUN_CACHE_CONTROL])
    : command;
}

/** The container's `toolchain.sh` preambles, whatever their scope. */
function toolchainPreambles(command: CiCommandStep): string[] {
  return command.commands.filter((line) => line.includes(TOOLCHAIN_PREAMBLE));
}

function withToolCacheVolumes<T extends CiCommandStep>(command: T): T {
  const preambles = toolchainPreambles(command);
  const fullScope = preambles.some(
    (line) => !line.includes(TOOLCHAIN_SCOPE_PREFIX),
  );
  return preambles.length === 0
    ? command
    : withVolumes(command, [
        ...COMMON_TOOL_CACHES,
        ...(fullScope ? FULL_TOOLCHAIN_CACHES : []),
      ]);
}

function withMiseInstallsVolume<T extends CiCommandStep>(command: T): T {
  return toolchainPreambles(command).length === 0
    ? command
    : withVolumes(command, [MISE_INSTALLS]);
}

function mapContainers(
  step: CiStep,
  transform: <T extends CiCommandStep>(command: T) => T,
): CiStep {
  if (step.backend === "local") return step;
  const transformed = transform(step);
  return step.orderedSteps === undefined
    ? transformed
    : {
        ...transformed,
        orderedSteps: step.orderedSteps.map((command) => transform(command)),
      };
}

/**
 * Point every in-cluster Bun install of the trusted graph at the shared cache.
 *
 * Without the mounted pair, `bun-install.sh` falls back to local mode and
 * downloads the whole dependency closure into `~/.bun` on the container's
 * writable layer -- the CI node's OS disk -- on every run. Pull-request
 * verification already shares this cache with main-branch maintenance, so
 * extending it to the remaining lanes crosses no new trust boundary. The
 * credentialless hosted-automation graph is built separately and never passes
 * through here. Host-agent steps have no pod to mount a claim into.
 */
export function withSharedBunCache(step: CiStep): CiStep {
  return mapContainers(step, withBunCacheVolumes);
}

/**
 * Mount the toolchain caches on every trusted container that sources
 * `ci/scripts/toolchain.sh`. Narrow scopes (automation, deployment, tofu,
 * postgres) only run Bun-based tooling and get the tool cache; the full scope
 * also compiles Rust and Go and builds with Gradle, so it gets every cache.
 * Same trust class as the Bun cache: trusted graph only, never credentialless.
 */
export function withSharedToolCaches(step: CiStep): CiStep {
  return mapContainers(step, withToolCacheVolumes);
}

/**
 * Mount the shared mise install claim on every trusted container that sources
 * `ci/scripts/toolchain.sh`, whatever its scope: each scope's `mise install`
 * writes the versions the image lacks, and only the mount moves those writes
 * off the OS disk. Applied by `performanceSteps` under its flag rather than
 * from `COMMON_TOOL_CACHES`, so the claim can be rolled out to canary branches
 * first; the credentialless graph never reaches either.
 */
export function withSharedMiseInstalls(step: CiStep): CiStep {
  return mapContainers(step, withMiseInstallsVolume);
}
