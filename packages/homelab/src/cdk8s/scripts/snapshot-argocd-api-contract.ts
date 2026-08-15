/**
 * Record ArgoCD's API error contract from a live server.
 *
 * The only piece of this mechanism that talks to ArgoCD. It issues a fixed set
 * of read-only probes, records what came back, and writes
 * `argocd-api-contract.json`, which the offline tests replay through the real
 * script. Probes use synthetic resource names that cannot exist, so the run is
 * deterministic and cannot mutate anything.
 *
 * Usage:
 *   bun packages/homelab/src/cdk8s/scripts/snapshot-argocd-api-contract.ts [--check]
 *
 * Env:
 *   ARGOCD_TOKEN      — required
 *   ARGOCD_SERVER_URL — optional, defaults to https://argocd.sjer.red
 *
 * Exit codes:
 *   0 — fixture written, or (with --check) it matches the live API
 *   1 — --check found drift
 *   2 — transport/auth failure, or a probe answered outside its recorded class
 *
 * Run it after an ArgoCD upgrade. The committed fixture is exactly as fresh as
 * the last run of this script: between an upgrade and a refresh the offline
 * tests pin a stale reality with full confidence, which is the one weakness of
 * the whole approach and cannot be closed from inside CI — the `verify` step
 * has no ArgoCD credentials.
 */

import { z } from "zod";
import {
  ARGOCD_API_CONTRACT_PATH,
  ArgocdApiContractSchema,
  type ArgocdApiContractCase,
} from "./argocd-api-contract.ts";

const DEFAULT_SERVER_URL = "https://argocd.sjer.red";

const VersionResponseSchema = z.object({ Version: z.string().min(1) });

/** Names chosen so no cluster can ever contain them. */
const ABSENT_JOB = "argocd-contract-probe-absent-job";
const ABSENT_CONFIG_MAP = "argocd-contract-probe-absent-configmap";
const ABSENT_APPLICATION = "argocd-contract-probe-absent-application";

type Probe = Omit<ArgocdApiContractCase, "response">;

/**
 * One probe per shape the script branches on. Every row is declared with the
 * class it must answer in; a probe that answers outside its class aborts the
 * run rather than rewriting the oracle, because a refresh against a down or
 * misconfigured server would otherwise silently replace the recording with
 * garbage that the offline tests would then faithfully pin.
 */
const PROBES: readonly Probe[] = [
  {
    name: "resource-absent-from-application",
    description:
      "A resource the revision introduces but the live tree does not carry. " +
      "ArgoCD fails the lookup with codes.InvalidArgument (3), which the gRPC " +
      "gateway renders as HTTP 400 — not 404 — so the message is the only " +
      "signal that this means absent.",
    endpoint: "resource",
    request: {
      application: "argocd",
      query: {
        resourceName: ABSENT_JOB,
        kind: "Job",
        group: "batch",
        version: "v1",
        namespace: "argocd",
      },
    },
    expect: "absent",
  },
  {
    name: "resource-absent-core-group",
    description:
      "The same absence for a core-group resource. The empty group leaves a " +
      "double space in the message, which is exactly the detail a " +
      "hand-written fake gets wrong.",
    endpoint: "resource",
    request: {
      application: "argocd",
      query: {
        resourceName: ABSENT_CONFIG_MAP,
        kind: "ConfigMap",
        group: "",
        version: "v1",
        namespace: "argocd",
      },
    },
    expect: "absent",
  },
  {
    name: "resource-unknown-application",
    description:
      "An unknown Application. ArgoCD resolves RBAC through the project it " +
      "cannot look up for a name that does not exist, so this is a permission " +
      "denial and must never be read as absence.",
    endpoint: "resource",
    request: {
      application: ABSENT_APPLICATION,
      query: {
        resourceName: ABSENT_CONFIG_MAP,
        kind: "ConfigMap",
        group: "",
        version: "v1",
        namespace: "argocd",
      },
    },
    expect: "error",
  },
  {
    name: "resource-malformed-query",
    description:
      "A request missing the required resourceName. Answered 5xx, so a broad " +
      "'400 means absent' shortcut would not swallow it — but a broad " +
      "'non-200 means absent' one would.",
    endpoint: "resource",
    request: {
      application: "argocd",
      query: { kind: "ConfigMap", group: "", version: "v1" },
    },
    expect: "error",
  },
  {
    name: "application-unknown-with-project",
    description:
      "An unknown Application read through getApplication WITH a project. The " +
      "project narrows the RBAC lookup, so this is the one place ArgoCD does " +
      "answer a clean 404 — which is why delete-application's wait loop can " +
      "rely on it.",
    endpoint: "application",
    request: {
      application: ABSENT_APPLICATION,
      query: { project: "default" },
    },
    expect: "error",
  },
  {
    name: "application-unknown-without-project",
    description:
      "The same read without a project. getApplication does not send one, so " +
      "a missing Application surfaces as a permission denial rather than a " +
      "404 — the reason its error mentions the possibility.",
    endpoint: "application",
    request: { application: ABSENT_APPLICATION, query: {} },
    expect: "error",
  },
];

function serverUrl(): string {
  return Bun.env["ARGOCD_SERVER_URL"] ?? DEFAULT_SERVER_URL;
}

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

function probeUrl(probe: Probe): URL {
  const suffix = probe.endpoint === "resource" ? "/resource" : "";
  const url = new URL(
    `/api/v1/applications/${encodeURIComponent(probe.request.application)}${suffix}`,
    serverUrl(),
  );
  for (const [key, value] of Object.entries(probe.request.query)) {
    url.searchParams.set(key, value);
  }
  return url;
}

/**
 * Which class a status belongs to, from the script's own point of view: only a
 * 200 is a live object, and only the recognized 400 is absence — but that
 * recognition is the message check under test, so this classifies by status
 * alone and the offline tests verify the message handling.
 */
function observedClass(status: number): "present" | "error" | "maybe-absent" {
  if (status === 200) {
    return "present";
  }
  return status === 400 ? "maybe-absent" : "error";
}

async function runProbe(
  token: string,
  entry: Probe,
): Promise<ArgocdApiContractCase> {
  const url = probeUrl(entry);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    die(
      `Probe ${entry.name} answered a non-JSON body (HTTP ${response.status.toString()}): ` +
        `${text.slice(0, 256)}\nRefusing to overwrite the contract fixture.`,
    );
  }

  const observed = observedClass(response.status);
  const acceptable =
    entry.expect === "absent"
      ? observed === "maybe-absent"
      : entry.expect === "present"
        ? observed === "present"
        : observed === "error";
  if (!acceptable) {
    die(
      `Probe ${entry.name} answered HTTP ${response.status.toString()}, which is not the ` +
        `recorded ${entry.expect} class.\nRefusing to overwrite the contract ` +
        `fixture — a refresh against a down or misconfigured server would ` +
        `replace the oracle with something the offline tests would then pin.`,
    );
  }

  return {
    ...entry,
    response: {
      status: response.status,
      // A 200 is recorded as a status only: the success shape is not what this
      // pins, and a live manifest would churn the fixture every deploy.
      ...(response.status === 200 ? {} : { body }),
    },
  };
}

async function serverVersion(token: string): Promise<string> {
  const response = await fetch(new URL("/api/version", serverUrl()), {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });
  if (!response.ok) {
    die(
      `Could not read the ArgoCD version: HTTP ${response.status.toString()}. ` +
        `Refusing to record a contract without the version it belongs to.`,
    );
  }
  const parsed = VersionResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    die("The ArgoCD version endpoint returned no Version string.");
  }
  return parsed.data.Version;
}

async function main(): Promise<void> {
  const check = Bun.argv.includes("--check");
  const token = Bun.env["ARGOCD_TOKEN"];
  if (token === undefined || token.length === 0) {
    die("ARGOCD_TOKEN is required.");
  }

  const argocdVersion = await serverVersion(token);
  const cases: ArgocdApiContractCase[] = [];
  for (const entry of PROBES) {
    cases.push(await runProbe(token, entry));
  }

  if (check) {
    const existing = ArgocdApiContractSchema.parse(
      await Bun.file(ARGOCD_API_CONTRACT_PATH).json(),
    );
    // Only `cases` is compared: generatedAt always differs, and a version bump
    // that did not change any answer is not drift.
    if (Bun.deepEquals(existing.cases, cases)) {
      console.log(
        `argocd-api-contract.json matches ${serverUrl()} (ArgoCD ${argocdVersion})`,
      );
      return;
    }
    const recordedByName = new Map(
      existing.cases.map((entry) => [entry.name, entry]),
    );
    for (const observed of cases) {
      const recorded = recordedByName.get(observed.name);
      if (
        recorded !== undefined &&
        Bun.deepEquals(recorded.response, observed.response)
      ) {
        continue;
      }
      console.error(`drift in ${observed.name}:`);
      console.error(`  recorded: ${JSON.stringify(recorded?.response)}`);
      console.error(`  observed: ${JSON.stringify(observed.response)}`);
    }
    console.error(
      `\nArgoCD ${argocdVersion} no longer answers what the fixture records. ` +
        `Re-record with: bun run argocd:contract`,
    );
    process.exit(1);
  }

  await Bun.write(
    ARGOCD_API_CONTRACT_PATH,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        server: serverUrl(),
        argocdVersion,
        cases,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `recorded ${cases.length.toString()} case(s) from ${serverUrl()} ` +
      `(ArgoCD ${argocdVersion})`,
  );
}

try {
  await main();
} catch (error) {
  // An operator CLI: surface the transport failure and stop. There is no CI
  // retry to classify for, because this never runs in the pipeline.
  die(error instanceof Error ? error.message : String(error));
}
