/**
 * Reaching a homelab PostgreSQL cluster from a laptop.
 *
 * None of the clusters has an ingress, a LoadBalancer, or a tailnet hostname,
 * so every connection goes through `kubectl`. The Zalando/Spilo pods also ship
 * several PostgreSQL toolchains at once — the one on `PATH` is the newest, not
 * the one matching the running server — which makes `pgBinaryPath` the whole
 * point of this module rather than an incidental helper.
 *
 * Each operation is split into a pure half that parses or decides and a thin
 * half that shells out, so the decisions are testable without a cluster.
 */
import { z } from "zod";

import { captureCommand, commandFailure } from "./command.ts";

const PodListSchema = z.object({
  items: z.array(
    z.object({
      metadata: z.object({ name: z.string(), uid: z.string() }),
      status: z.object({
        conditions: z.array(z.object({ status: z.string(), type: z.string() })),
        phase: z.string(),
      }),
    }),
  ),
});

const ServerVersionPattern = /^(\d+)/;

/** A PostgreSQL binary this module is willing to name a path for. */
export type PostgresBinary = "pg_dump" | "pg_restore" | "psql";

/** The pod backing a cluster, with the uid callers record as provenance. */
export type PostgresPod = {
  readonly name: string;
  readonly uid: string;
};

/** Which cluster to look for, and where. */
export type ClusterTarget = {
  readonly namespace: string;
  readonly cluster: string;
};

export type PodExec = {
  readonly namespace: string;
  readonly pod: string;
  readonly container?: string | undefined;
  readonly command: readonly string[];
};

/**
 * Absolute path to a version-matched binary inside a Spilo pod.
 *
 * The pod's `PATH` resolves `pg_dump` to the newest toolchain it carries, which
 * is routinely several majors ahead of the server it is running. That newer
 * `pg_dump` writes a custom-format archive the local `pg_restore` cannot read,
 * and it does so while exiting 0 and producing a plausible-looking file — so
 * the mismatch surfaces as a corrupt restore, not a failed dump.
 */
export function pgBinaryPath(major: number, binary: PostgresBinary): string {
  if (!Number.isInteger(major) || major < 1) {
    throw new Error(
      `PostgreSQL major version must be a positive integer, got ${String(major)}`,
    );
  }
  return `/usr/lib/postgresql/${String(major)}/bin/${binary}`;
}

/** Major version from a `SHOW server_version` value such as "16.13 (Ubuntu ...)". */
export function parseMajorVersion(output: string): number {
  const matched = ServerVersionPattern.exec(output.trim());
  const major = matched?.[1];
  if (major === undefined) {
    throw new Error(
      `Could not read a PostgreSQL major version from ${JSON.stringify(output.trim())}`,
    );
  }
  return Number.parseInt(major, 10);
}

/**
 * The one ready master pod for a cluster, or a throw explaining what was found.
 *
 * Selection is by Spilo's own labels rather than a name prefix so a replica can
 * never be chosen: a read-only replica accepts `pg_dump` happily and would look
 * like success.
 */
export function selectReadyMasterPod(
  podList: unknown,
  target: ClusterTarget,
): PostgresPod {
  const ready = PodListSchema.parse(podList).items.filter(
    (pod) =>
      pod.status.phase === "Running" &&
      pod.status.conditions.some(
        (condition) =>
          condition.type === "Ready" && condition.status === "True",
      ),
  );
  const [pod] = ready;
  if (pod === undefined || ready.length !== 1) {
    throw new Error(
      `Expected exactly one ready master pod for ${target.cluster} in ${target.namespace}, found ${String(ready.length)}`,
    );
  }
  return pod.metadata;
}

/** `kubectl` argv selecting a cluster's master pod. */
export function masterPodQueryArgs(target: ClusterTarget): string[] {
  return [
    "kubectl",
    "get",
    "pods",
    "--namespace",
    target.namespace,
    "--selector",
    `application=spilo,cluster-name=${target.cluster},spilo-role=master`,
    "--output",
    "json",
  ];
}

/** `kubectl exec` argv for a command inside a pod. */
export function podExecArgs(input: PodExec): string[] {
  return [
    "kubectl",
    "exec",
    "--namespace",
    input.namespace,
    ...(input.container === undefined ? [] : ["--container", input.container]),
    input.pod,
    "--",
    ...input.command,
  ];
}

/** Find the single ready master pod for a cluster. */
export async function findReadyMasterPod(
  target: ClusterTarget,
): Promise<PostgresPod> {
  const output = await captureCommand({
    args: masterPodQueryArgs(target),
    label: "kubectl get pods",
  });
  const parsed: unknown = JSON.parse(output);
  return selectReadyMasterPod(parsed, target);
}

/** Run a command in a pod and return its stdout as text. */
export async function execInPod(input: PodExec): Promise<string> {
  return captureCommand({
    args: podExecArgs(input),
    label: `kubectl exec ${input.namespace}/${input.pod}`,
  });
}

/**
 * Run a command in a pod, streaming its stdout to a file.
 *
 * Separate from `execInPod` because a custom-format dump is binary: decoding it
 * as text to hand back a string corrupts the archive.
 */
export async function execInPodToFile(
  input: PodExec & { readonly destination: string },
): Promise<number> {
  const args = podExecArgs(input);
  const child = Bun.spawn(args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  // Drained concurrently with stdout: a pod that fills the stderr pipe while
  // we are still reading the archive would otherwise deadlock.
  const stderrText = new Response(child.stderr).text();
  // Written through a FileSink rather than the shorter
  // `Bun.write(destination, new Response(child.stdout))`, which on Bun 1.4
  // never settles for a spawn pipe: it spins at full CPU after the child has
  // already exited, so the symptom is a hang with no process left to blame.
  const sink = Bun.file(input.destination).writer();
  let written = 0;
  for await (const chunk of child.stdout) {
    written += chunk.byteLength;
    // Awaited for backpressure: a large archive would otherwise queue in
    // memory faster than it reaches disk.
    await sink.write(chunk);
  }
  await sink.end();
  const [stderr, exitCode] = await Promise.all([stderrText, child.exited]);
  if (exitCode !== 0) {
    throw commandFailure(
      `kubectl exec ${input.namespace}/${input.pod}`,
      exitCode,
      stderr,
    );
  }
  return written;
}

/** The major version of the server running in a pod. */
export async function serverMajorVersion(input: {
  readonly namespace: string;
  readonly pod: string;
  readonly container?: string | undefined;
  readonly database: string;
}): Promise<number> {
  const output = await execInPod({
    namespace: input.namespace,
    pod: input.pod,
    container: input.container,
    command: [
      "psql",
      "--username",
      "postgres",
      "--dbname",
      input.database,
      "--no-align",
      "--tuples-only",
      "--command",
      "SHOW server_version",
    ],
  });
  return parseMajorVersion(output);
}
