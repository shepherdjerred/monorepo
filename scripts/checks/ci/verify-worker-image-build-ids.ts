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
 * Scope: stable, candidate, and retained Workflow image pins.
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
 *   bun scripts/checks/ci/verify-worker-image-build-ids.ts [--offline]
 *
 * Exit codes: 0 all pins verified, 1 a pin failed verification.
 */
import { z } from "zod";
import { bakedGitSha, digestForCommitTag } from "./worker-image-registry.ts";

const CATALOG_PATH = "packages/version-catalog/src/catalog.json";
const PIN_STATE_PATH = "scripts/pin-candidates-state.json";

/** Only these pins join a Worker Deployment, so only these have a routing-significant Build ID. */
const WORKFLOW_PIN_PATTERN =
  /\/workflows\/(?:stable|candidate|retained-[a-f0-9]{12})$/;

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
    const retainedPrefix = /\/workflows\/retained-([a-f0-9]{12})$/.exec(
      pin.name,
    )?.[1];
    if (
      retainedPrefix !== undefined &&
      (recorded === undefined ||
        pin.recordedGitSha?.slice(0, 12) !== retainedPrefix)
    ) {
      findings.push(
        `${pin.name}: retained pin must record its matching gitSha`,
      );
    }
  }
  findings.push(...digestCoherenceFindings(pins));
  return findings;
}

async function verifyAgainstRegistry(pin: WorkflowPin): Promise<string[]> {
  const resolved = await bakedGitSha(pin.repository, pin.digest);
  const findings: string[] = [];
  if (pin.recordedGitSha !== undefined && pin.recordedGitSha !== resolved) {
    findings.push(
      `${pin.name}: recorded gitSha ${pin.recordedGitSha} but ${pin.version} is built from ${resolved}`,
    );
  }
  const roundTrip = await digestForCommitTag(pin.repository, resolved);
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
