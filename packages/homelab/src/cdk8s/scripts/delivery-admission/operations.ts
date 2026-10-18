import { z } from "zod";
import type { loadAdmissionFixtures } from "./fixtures.ts";

type Result = { code: number; stdout: string; stderr: string };
type Execute = (parameters: string[], input?: unknown) => Promise<Result>;
export type AdmissionCase = { name: string; allowed: boolean; layer?: string };
const ACTOR =
  "system:serviceaccount:delivery-tsmc-controller:delivery-tsmc-controller";
const Metadata = z.object({
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
    uid: z.string(),
    resourceVersion: z.string(),
  }),
});

type Fixtures = Awaited<ReturnType<typeof loadAdmissionFixtures>>;
type RecordCase = (name: string, allowed: boolean, layer: string) => void;

async function proveConnect(
  execute: Execute,
  fixtures: Fixtures,
  record: RecordCase,
) {
  for (const method of ["POST", "GET"]) {
    for (const [name, pod, container, command, allowed] of [
      [
        "player count",
        "minecraft-tsmc-0",
        "minecraft-tsmc",
        ["rcon-cli", "minecraft:list"],
        true,
      ],
      [
        "server shell",
        "minecraft-tsmc-0",
        "minecraft-tsmc",
        ["sh", "-c", "id"],
        false,
      ],
      [
        "readonly source tar",
        fixtures.sourceReader.metadata.name,
        "reader",
        ["tar", "-C", "/data", "-cf", "-", "."],
        true,
      ],
      [
        "source tar write",
        fixtures.sourceReader.metadata.name,
        "reader",
        ["tar", "-C", "/data", "-xf", "-"],
        false,
      ],
      [
        "reader shell",
        fixtures.sourceReader.metadata.name,
        "reader",
        ["sh", "-c", "id"],
        false,
      ],
    ] satisfies [string, string, string, string[], boolean][]) {
      await assertConnect(
        execute,
        { method, name, pod, container, command, allowed },
        record,
      );
    }
  }
}

async function assertConnect(
  execute: Execute,
  input: {
    method: string;
    name: string;
    pod: string;
    container: string;
    command: string[];
    allowed: boolean;
  },
  record: RecordCase,
) {
  const { method, name, pod, container, command, allowed } = input;
  const query = new URLSearchParams({
    container,
    stdout: "true",
    stderr: "true",
  });
  for (const value of command) query.append("command", value);
  const route = `/api/v1/namespaces/minecraft-tsmc/pods/${pod}/exec?${query.toString()}`;
  const result = await execute(
    [
      `--as=${ACTOR}`,
      method === "POST" ? "create" : "get",
      "--raw",
      route,
      ...(method === "POST" ? ["-f", "-"] : []),
    ],
    method === "POST" ? {} : undefined,
  );
  // These Pods intentionally do not exist. A 404 after admission proves the
  // exact command passed; forbidden commands must instead hit the named VAP.
  const expected = allowed
    ? result.stderr.includes("(NotFound)")
    : result.stderr.includes("delivery-tsmc-exec.sjer.red");
  if (!expected)
    throw new Error(
      `${method} ${name}: unexpected CONNECT result ${result.stderr.slice(0, 2000)}`,
    );
  record(
    `${method} CONNECT ${name}`,
    allowed,
    "controller-admission-before-pod-lookup",
  );
}

async function proveSourceDeletes(execute: Execute, record: RecordCase) {
  for (const kind of ["statefulset", "service"]) {
    const result = await execute([
      `--as=${ACTOR}`,
      "-n",
      "minecraft-tsmc",
      "delete",
      kind,
      "minecraft-tsmc",
      "--wait=false",
    ]);
    if (result.code === 0 || !result.stderr.includes(".sjer.red"))
      throw new Error(
        `Source ${kind} delete lacked controller-policy denial: ${result.stderr.slice(0, 2000)}`,
      );
    record(`production ${kind} delete`, false, "controller-admission");
  }
}

function requireDeleteResult(
  result: Result,
  expected: {
    resource: string;
    variant: string;
    policy: string;
    allowed: boolean;
  },
) {
  const { resource, variant, policy, allowed } = expected;
  const storageRejected =
    result.stderr.includes("(Conflict)") &&
    ((variant === "wrong UID" &&
      result.stderr.includes("UID in the precondition")) ||
      (variant === "wrong resource version" &&
        result.stderr.includes("ResourceVersion in the precondition")));
  if (
    (result.code === 0) !== allowed ||
    (!allowed && !storageRejected && !result.stderr.includes(policy))
  )
    throw new Error(
      `${resource} ${variant}: expected ${allowed ? "allow" : "named delete-policy denial"}; ${result.stderr.slice(0, 2000)}`,
    );

  return storageRejected;
}

async function proveDeleteIncarnation(
  execute: Execute,
  target: { resource: string; name: string; policy: string },
  record: RecordCase,
) {
  const { resource, name, policy } = target;
  const namespace = "minecraft-tsmc-delivery-validation";
  const read = await execute([
    "-n",
    namespace,
    "get",
    resource,
    name,
    "-o",
    "json",
  ]);
  if (read.code !== 0)
    throw new Error(`Cannot inspect inert delete fixture: ${read.stderr}`);
  const current = Metadata.parse(JSON.parse(read.stdout)).metadata;
  for (const [variant, preconditions, allowed] of [
    ["missing preconditions", undefined, false],
    [
      "wrong UID",
      {
        uid: "00000000-0000-4000-8000-000000000000",
        resourceVersion: current.resourceVersion,
      },
      false,
    ],
    [
      "wrong resource version",
      { uid: current.uid, resourceVersion: "0" },
      false,
    ],
    [
      "exact UID and resource version",
      { uid: current.uid, resourceVersion: current.resourceVersion },
      true,
    ],
  ] satisfies [
    string,
    { uid: string; resourceVersion: string } | undefined,
    boolean,
  ][]) {
    const result = await execute(
      [
        `--as=${ACTOR}`,
        "delete",
        "--raw",
        `/api/v1/namespaces/${namespace}/${resource}/${name}`,
        "-f",
        "-",
      ],
      {
        apiVersion: "v1",
        kind: "DeleteOptions",
        gracePeriodSeconds: 0,
        ...(preconditions === undefined ? {} : { preconditions }),
      },
    );
    const storageRejected = requireDeleteResult(result, {
      resource,
      variant,
      policy,
      allowed,
    });
    if (!allowed) {
      const preserved = await execute([
        "-n",
        namespace,
        "get",
        resource,
        name,
        "-o",
        "json",
      ]);
      if (
        preserved.code !== 0 ||
        Metadata.parse(JSON.parse(preserved.stdout)).metadata.uid !==
          current.uid
      )
        throw new Error(
          "Rejected deletion did not preserve the exact fixture incarnation",
        );
    }
    record(
      `${resource} delete ${variant}`,
      allowed,
      storageRejected ? "storage-precondition" : "controller-admission",
    );
  }
}

async function proveCopyDeletes(
  execute: Execute,
  fixtures: Fixtures,
  record: RecordCase,
) {
  const namespace = "minecraft-tsmc-delivery-validation";
  const claim = "datadir-minecraft-tsmc-0";
  const apply = await execute(
    ["apply", "--server-side", "--force-conflicts", "-f", "-"],
    {
      apiVersion: "v1",
      kind: "List",
      items: [
        {
          apiVersion: "v1",
          kind: "PersistentVolumeClaim",
          metadata: {
            name: claim,
            namespace,
            labels: {
              "velero.io/restore-name":
                "storm-verify-6903b19f-f4d2-42a5-91ba-6ce046562c83",
            },
          },
          spec: {
            storageClassName: "",
            accessModes: ["ReadWriteOnce"],
            resources: { requests: { storage: "1Mi" } },
          },
        },
        fixtures.candidate,
      ],
    },
  );
  if (apply.code !== 0)
    throw new Error(
      `Inert copy fixtures failed: ${apply.stderr.slice(0, 2000)}`,
    );
  for (const [resource, name, policy] of [
    ["persistentvolumeclaims", claim, "delivery-tsmc-copy-delete.sjer.red"],
    [
      "pods",
      fixtures.candidate.metadata.name,
      "delivery-tsmc-pod-delete.sjer.red",
    ],
  ]) {
    if (resource === undefined || name === undefined || policy === undefined)
      throw new Error("Missing delete proof target");

    await proveDeleteIncarnation(execute, { resource, name, policy }, record);
  }
}

export async function proveAdditionalOperations(
  execute: Execute,
  fixtures: Fixtures,
) {
  const results: AdmissionCase[] = [];
  const record: RecordCase = (name, allowed, layer) => {
    results.push({ name, allowed, layer });
    console.log(`${allowed ? "ALLOW" : "DENY"} ${name}`);
  };
  await proveConnect(execute, fixtures, record);
  await proveSourceDeletes(execute, record);
  try {
    await proveCopyDeletes(execute, fixtures, record);
  } finally {
    await clearInertCopyFixtures(execute, fixtures);
  }
  return results;
}

/** Cleanup is only for this node-free local proof, never the production controller. */
export async function clearInertCopyFixtures(
  execute: Execute,
  fixtures: Fixtures,
) {
  const namespace = "minecraft-tsmc-delivery-validation";
  for (const [resource, name] of [
    ["persistentvolumeclaims", "datadir-minecraft-tsmc-0"],
    ["pods", fixtures.candidate.metadata.name],
  ]) {
    if (resource === undefined || name === undefined)
      throw new Error("Missing cleanup fixture identity");
    const prior = await execute([
      "-n",
      namespace,
      "get",
      resource,
      name,
      "--ignore-not-found",
      "-o",
      "json",
    ]);
    if (prior.code !== 0)
      throw new Error("Cannot inspect inert cleanup fixture");
    if (prior.stdout.trim() === "") continue;
    const value = z
      .object({
        metadata: Metadata.shape.metadata,
        spec: z.object({
          nodeName: z.string().optional(),
          volumeName: z.string().optional(),
          storageClassName: z.string().optional(),
        }),
      })
      .parse(JSON.parse(prior.stdout));
    if (
      value.spec.nodeName !== undefined ||
      value.spec.volumeName !== undefined ||
      (resource === "persistentvolumeclaims" &&
        value.spec.storageClassName !== "")
    )
      throw new Error(
        "Cleanup refuses any scheduled Pod or bound/provisioned claim",
      );
    const result = await execute(
      [
        "delete",
        "--raw",
        `/api/v1/namespaces/${namespace}/${resource}/${name}`,
        "-f",
        "-",
      ],
      {
        apiVersion: "v1",
        kind: "DeleteOptions",
        gracePeriodSeconds: 0,
        preconditions: {
          uid: value.metadata.uid,
          resourceVersion: value.metadata.resourceVersion,
        },
      },
    );
    if (result.code !== 0)
      throw new Error(
        `Inert fixture cleanup failed: ${result.stderr.slice(0, 1000)}`,
      );
  }
}
