/**
 * Verify that every Temporal Worker Deployment image pin actually contains the
 * commit it is believed to have been built from.
 *
 * Why this exists: a pin records a version and a digest, and nothing else. The
 * commit is implied. On 2026-08-31 the `workflows/stable` pin read
 * `2.0.0-13000` and was assumed to be `c42ee297`; the image is built from
 * `3f9be51c`. prod's Worker Deployment was pointed at `c42ee297`, which no
 * running pod carried, and the workflow plane stalled with every poller
 * reporting healthy. Build numbers do not order with commits — 13000 is
 * `3f9be51c` while 13153 is `c42ee297` — so the mistake was invisible.
 *
 * Scope: pins whose name ends in `/workflows/stable` or `/workflows/candidate`.
 * Those are the images that join a Worker Deployment, where a Build ID is
 * routing-significant. Activity-only worker images do not join one and are
 * deliberately excluded.
 *
 * Two modes:
 *   --offline   internal consistency only; safe for the `verify` graph, which
 *               never touches the network.
 *   (default)   additionally proves each pin against the registry.
 *
 * Usage:
 *   bun scripts/checks/verify-worker-image-build-ids.ts [--offline]
 *
 * Exit codes: 0 all pins verified, 1 a pin failed verification.
 */
import { z } from "zod";

const CATALOG_PATH = "packages/version-catalog/src/catalog.json";
const PIN_STATE_PATH = "scripts/pin-candidates-state.json";
const REGISTRY = "ghcr.io";

/** Only these pins join a Worker Deployment, so only these have a routing-significant Build ID. */
const WORKFLOW_PIN_PATTERN = /\/workflows\/(?:stable|candidate)$/;

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

const GitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
const PinValueSchema = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+-\d+@sha256:[0-9a-f]{64}$/,
    "pin must be version@digest",
  );

export type WorkflowPin = {
  readonly name: string;
  readonly version: string;
  readonly digest: string;
  readonly repository: string;
  readonly recordedGitSha: string | undefined;
};

/**
 * The image repository a pin refers to.
 *
 * `shepherdjerred/temporal-worker/workflows/stable` -> `shepherdjerred/temporal-worker`
 * `shepherdjerred/scout-for-lol/beta/workflows/stable` -> `shepherdjerred/scout-for-lol`
 *
 * The stage segment is part of the pin's identity, not the repository: both
 * Scout stages are published to one repository.
 */
export function repositoryForPin(pinName: string): string {
  const [prefix] = pinName.split("/workflows/");
  if (prefix === undefined) throw new Error(`Not a workflow pin: ${pinName}`);
  return prefix.replace(/\/(?:beta|prod)$/, "");
}

function collectNamedValues(
  node: unknown,
  found: { name: string; value: string }[],
): void {
  if (Array.isArray(node)) {
    for (const entry of node) collectNamedValues(entry, found);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record: Record<string, unknown> = { ...node };
  const name = record["name"];
  const value = record["value"];
  if (typeof name === "string" && typeof value === "string") {
    found.push({ name, value });
  }
  for (const entry of Object.values(record)) collectNamedValues(entry, found);
}

export function selectWorkflowPins(
  catalog: unknown,
  pinState: Readonly<Record<string, { gitSha?: string | undefined }>>,
): WorkflowPin[] {
  const found: { name: string; value: string }[] = [];
  collectNamedValues(catalog, found);
  return found
    .filter((entry) => WORKFLOW_PIN_PATTERN.test(entry.name))
    .map((entry) => {
      const value = PinValueSchema.parse(entry.value);
      const [version, digest] = value.split("@");
      if (version === undefined || digest === undefined) {
        throw new Error(`Unparseable pin ${entry.name}`);
      }
      return {
        name: entry.name,
        version,
        digest,
        repository: repositoryForPin(entry.name),
        recordedGitSha: pinState[entry.name]?.gitSha,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** A pin's build number must match the version it is recorded against. */
type RecordedPin = {
  version: string;
  digest: string;
  buildNumber: number;
};

function pinFindings(pin: WorkflowPin, recorded: RecordedPin): string[] {
  const findings: string[] = [];
  if (recorded.digest !== pin.digest) {
    findings.push(
      `${pin.name}: catalog digest ${pin.digest} but pin state records ${recorded.digest}`,
    );
  }
  if (recorded.version !== pin.version) {
    findings.push(
      `${pin.name}: catalog version ${pin.version} but pin state records ${recorded.version}`,
    );
  }
  if (!pin.version.endsWith(`-${recorded.buildNumber.toString()}`)) {
    findings.push(
      `${pin.name}: version ${pin.version} does not match buildNumber ${recorded.buildNumber.toString()}`,
    );
  }
  if (
    pin.recordedGitSha !== undefined &&
    !GitShaSchema.safeParse(pin.recordedGitSha).success
  ) {
    findings.push(
      `${pin.name}: gitSha ${pin.recordedGitSha} is not a 40-character lowercase commit`,
    );
  }
  return findings;
}

/**
 * Two pins holding the same image must agree on the commit that produced it.
 *
 * This is the outage detectable offline: one image recorded against two
 * commits means at least one of them is wrong, and a Worker Deployment routed
 * to the wrong one finds no pollers.
 */
function digestCoherenceFindings(pins: readonly WorkflowPin[]): string[] {
  const commitsByDigest = new Map<string, Set<string>>();
  for (const pin of pins) {
    if (pin.recordedGitSha === undefined) continue;
    const commits = commitsByDigest.get(pin.digest) ?? new Set<string>();
    commits.add(pin.recordedGitSha);
    commitsByDigest.set(pin.digest, commits);
  }
  const findings: string[] = [];
  for (const [digest, commits] of commitsByDigest) {
    if (commits.size > 1) {
      findings.push(
        `digest ${digest} is recorded against multiple commits: ${[...commits].join(", ")}`,
      );
    }
  }
  return findings;
}

export function offlineFindings(
  pins: readonly WorkflowPin[],
  pinState: Readonly<Record<string, RecordedPin>>,
): string[] {
  const findings: string[] = [];
  for (const pin of pins) {
    const recorded = pinState[pin.name];
    if (recorded !== undefined) findings.push(...pinFindings(pin, recorded));
  }
  findings.push(...digestCoherenceFindings(pins));
  return findings;
}

async function registryToken(repository: string): Promise<string> {
  const url = new URL(`https://${REGISTRY}/token`);
  url.searchParams.set("scope", `repository:${repository}:pull`);
  url.searchParams.set("service", REGISTRY);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `token request for ${repository} failed with ${response.status.toString()}`,
    );
  }
  const body: unknown = await response.json();
  const token = z.object({ token: z.string() }).parse(body).token;
  return token;
}

/** Read the `GIT_SHA` baked into an image's config, without pulling a layer. */
async function bakedGitSha(
  repository: string,
  digest: string,
  token: string,
): Promise<string> {
  const headers = { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPT };
  const indexResponse = await fetch(
    `https://${REGISTRY}/v2/${repository}/manifests/${digest}`,
    { headers },
  );
  if (!indexResponse.ok) {
    throw new Error(
      `manifest ${digest} returned ${indexResponse.status.toString()}`,
    );
  }
  const index: unknown = await indexResponse.json();
  const parsed = z
    .object({
      config: z.object({ digest: z.string() }).optional(),
      manifests: z
        .array(
          z.object({
            digest: z.string(),
            platform: z
              .object({ architecture: z.string().optional() })
              .optional(),
          }),
        )
        .optional(),
    })
    .parse(index);
  let configDigest = parsed.config?.digest;
  if (configDigest === undefined) {
    // An index also carries an attestation manifest with architecture
    // "unknown"; the real image is the one with a concrete architecture.
    const platform = (parsed.manifests ?? []).find(
      (entry) =>
        entry.platform?.architecture !== undefined &&
        entry.platform.architecture !== "unknown",
    );
    if (platform === undefined) {
      throw new Error(`no platform manifest under ${digest}`);
    }
    const manifestResponse = await fetch(
      `https://${REGISTRY}/v2/${repository}/manifests/${platform.digest}`,
      { headers },
    );
    const manifest: unknown = await manifestResponse.json();
    configDigest = z
      .object({ config: z.object({ digest: z.string() }) })
      .parse(manifest).config.digest;
  }
  const configResponse = await fetch(
    `https://${REGISTRY}/v2/${repository}/blobs/${configDigest}`,
    { headers, redirect: "follow" },
  );
  const config: unknown = await configResponse.json();
  const environment =
    z
      .object({ config: z.object({ Env: z.array(z.string()).optional() }) })
      .parse(config).config.Env ?? [];
  const entry = environment.find((value) => value.startsWith("GIT_SHA="));
  if (entry === undefined) {
    throw new Error(`image ${digest} bakes no GIT_SHA`);
  }
  return entry.slice("GIT_SHA=".length);
}

/**
 * Resolve the `candidate-<sha>` tag back to a digest.
 *
 * docker-bake pushes exactly this tag for every image and nothing prunes it,
 * so it is a permanent forward index from commit to digest. Closing the loop
 * against it proves the pin/commit correspondence without trusting anything
 * recorded in the repo.
 */
async function digestForCommitTag(
  repository: string,
  gitSha: string,
  token: string,
): Promise<string | undefined> {
  const response = await fetch(
    `https://${REGISTRY}/v2/${repository}/manifests/candidate-${gitSha}`,
    {
      method: "HEAD",
      headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPT },
    },
  );
  if (!response.ok) return undefined;
  return response.headers.get("docker-content-digest") ?? undefined;
}

async function verifyAgainstRegistry(pin: WorkflowPin): Promise<string[]> {
  const token = await registryToken(pin.repository);
  const resolved = await bakedGitSha(pin.repository, pin.digest, token);
  const findings: string[] = [];
  if (pin.recordedGitSha !== undefined && pin.recordedGitSha !== resolved) {
    findings.push(
      `${pin.name}: recorded gitSha ${pin.recordedGitSha} but ${pin.version} is built from ${resolved}`,
    );
  }
  const roundTrip = await digestForCommitTag(pin.repository, resolved, token);
  if (roundTrip !== undefined && roundTrip !== pin.digest) {
    findings.push(
      `${pin.name}: candidate-${resolved} resolves to ${roundTrip}, not the pinned ${pin.digest}`,
    );
  }
  console.log(
    `  ${pin.name}\n    ${pin.version} @ ${pin.digest.slice(0, 19)}… built from ${resolved}`,
  );
  return findings;
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const catalog: unknown = await Bun.file(CATALOG_PATH).json();
  const stateFile: unknown = await Bun.file(PIN_STATE_PATH).json();
  const pinState = z
    .object({
      pins: z.record(
        z.string(),
        z.object({
          version: z.string(),
          digest: z.string(),
          buildNumber: z.number(),
          gitSha: z.string().optional(),
        }),
      ),
    })
    .parse(stateFile).pins;

  const pins = selectWorkflowPins(catalog, pinState);
  if (pins.length === 0) {
    throw new Error(
      "No Worker Deployment image pins found; the selection rule is stale",
    );
  }
  console.log(
    `Checking ${pins.length.toString()} Worker Deployment image pin(s)${offline ? " (offline)" : ""}`,
  );

  const findings = offlineFindings(pins, pinState);
  if (!offline) {
    for (const pin of pins)
      findings.push(...(await verifyAgainstRegistry(pin)));
  }

  if (findings.length > 0) {
    console.error(`\n${findings.length.toString()} problem(s):`);
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exit(1);
  }
  console.log("All Worker Deployment image pins verified.");
}

if (import.meta.main) await main();
