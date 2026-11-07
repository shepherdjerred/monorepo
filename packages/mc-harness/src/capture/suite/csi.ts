import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import { z } from "zod";
import { MC_DIR } from "#protocol/paths.ts";
import { DEFAULT_KUBE_CONTEXT } from "#protocol/cluster.ts";
import { command, commandBytes } from "./process.ts";
import {
  FixtureFileSchema,
  worldFolder,
  type FixtureSource,
} from "./fixture.ts";

const namespace = "minecraft-tsmc";
const kubectlBase = ["kubectl", "--context", DEFAULT_KUBE_CONTEXT];
const kubectl = [...kubectlBase, "-n", namespace];
const ClaimSchema = z.object({
  spec: z.object({
    resources: z.object({ requests: z.object({ storage: z.string() }) }),
  }),
});
const PodSchema = z.object({
  status: z.object({
    containerStatuses: z.array(
      z.object({ name: z.string(), imageID: z.string() }),
    ),
  }),
});
const OwnedSchema = z.object({
  metadata: z.object({
    uid: z.string(),
    labels: z.record(z.string(), z.string()),
  }),
});

async function deleteOwned(name: string, owner: string): Promise<void> {
  for (const kind of ["pod", "pvc", "volumesnapshot"]) {
    const raw = await command([
      ...kubectl,
      "get",
      kind,
      name,
      "--ignore-not-found",
      "-o",
      "json",
    ]);
    if (raw.trim() === "") continue;
    const object = OwnedSchema.parse(JSON.parse(raw));
    if (object.metadata.labels["sjer.red/mc-capture"] !== owner)
      throw new Error(`Refusing cleanup of unowned ${kind}/${name}`);
    const resource =
      kind === "volumesnapshot"
        ? `apis/snapshot.storage.k8s.io/v1/namespaces/${namespace}/volumesnapshots`
        : `api/v1/namespaces/${namespace}/${kind === "pod" ? "pods" : "persistentvolumeclaims"}`;
    await command(
      [...kubectlBase, "delete", "--raw", `/${resource}/${name}`, "-f", "-"],
      JSON.stringify({
        apiVersion: "v1",
        kind: "DeleteOptions",
        preconditions: { uid: object.metadata.uid },
      }),
    );
    await command([
      ...kubectl,
      "wait",
      `${kind}/${name}`,
      "--for=delete",
      "--timeout=60s",
    ]);
  }
}

const ReceiptSchema = z.strictObject({
  schema: z.literal(1),
  id: z.uuid(),
  namespace: z.literal(namespace),
  name: z.string(),
  state: z.literal("exporting"),
});
const receiptPath = (id: string) =>
  path.join(MC_DIR, "suite-exports", `${z.uuid().parse(id)}.json`);

/** Explicit recovery after interruption; labels and API UID preconditions bind every delete. */
export async function recoverExport(id: string): Promise<void> {
  const file = receiptPath(id),
    receipt = ReceiptSchema.parse(await Bun.file(file).json());
  if (receipt.id !== id || receipt.name !== `mc-capture-${id}`)
    throw new Error("Export receipt identity differs");
  await deleteOwned(receipt.name, receipt.id);
  await unlink(file);
}

/** A stable read view; the source PVC is never mounted by the export pod. */
export async function verifyLiveFixtureClass(): Promise<void> {
  z.object({
    reclaimPolicy: z.literal("Delete"),
    provisioner: z.literal("zfs.csi.openebs.io"),
  }).parse(
    JSON.parse(
      await command([
        ...kubectlBase,
        "get",
        "storageclass",
        "mc-capture-fixture",
        "-o",
        "json",
      ]),
    ),
  );
}

export async function withLiveFixture<T>(
  repoRoot: string,
  action: (source: FixtureSource) => Promise<T>,
): Promise<T> {
  await verifyLiveFixtureClass();
  const claim = ClaimSchema.parse(
    JSON.parse(
      await command([
        ...kubectl,
        "get",
        "pvc",
        "datadir-minecraft-tsmc-0",
        "-o",
        "json",
      ]),
    ),
  );
  const pod = PodSchema.parse(
    JSON.parse(
      await command([
        ...kubectl,
        "get",
        "pod",
        "minecraft-tsmc-0",
        "-o",
        "json",
      ]),
    ),
  );
  const container = pod.status.containerStatuses.find(
    (c) => c.name === "minecraft-tsmc",
  );
  if (container === undefined)
    throw new Error("Live Minecraft container is unavailable");
  const image = container.imageID.replace(/^docker-pullable:\/\//u, "");
  const id = randomUUID(),
    name = `mc-capture-${id}`;
  const resources = await command(
    [
      "bun",
      path.join(
        repoRoot,
        "packages/homelab/scripts/minecraft/capture-resources.ts",
      ),
    ],
    JSON.stringify({
      id,
      sourceClaim: "datadir-minecraft-tsmc-0",
      capacity: claim.spec.resources.requests.storage,
      image,
    }),
  );
  await command([
    "bun",
    path.join(repoRoot, "packages/toolkit/src/index.ts"),
    "mc",
    "cmd",
    "--target",
    "live",
    "--reason",
    "Flush saved terrain before bounded documentation export",
    "minecraft:save-all",
    "flush",
  ]);
  await mkdir(path.dirname(receiptPath(id)), { recursive: true, mode: 0o700 });
  await Bun.write(
    receiptPath(id),
    JSON.stringify({ schema: 1, id, namespace, name, state: "exporting" }),
    { mode: 0o600 },
  );
  try {
    await command([...kubectl, "create", "-f", "-"], resources);
    await command([
      ...kubectl,
      "wait",
      `volumesnapshot/${name}`,
      "--for=jsonpath={.status.readyToUse}=true",
      "--timeout=120s",
    ]);
    await command([
      ...kubectl,
      "wait",
      `pod/${name}`,
      "--for=condition=Ready",
      "--timeout=120s",
    ]);
    return await action({
      id: `csi:${namespace}/${name}`,
      metadata: async (worlds) => {
        const folders = [
          "data/minecraft",
          "datapacks",
          ...new Set(
            worlds.map(
              (world) =>
                `dimensions/minecraft/${worldFolder(world)}/data/minecraft`,
            ),
          ),
        ];
        const script =
          "import json,os,sys; root='/snapshot/world'; result=[]\nfor folder in json.loads(sys.argv[1]):\n p=os.path.join(root,folder)\n if not os.path.exists(p): continue\n if os.path.realpath(p)!=p: raise RuntimeError('Linked fixture directory')\n for base,dirs,files in os.walk(p):\n  for n in dirs+files:\n   if os.path.islink(os.path.join(base,n)): raise RuntimeError('Linked fixture path')\n  result.extend(os.path.relpath(os.path.join(base,n),root) for n in files)\nprint(json.dumps(result))";
        const files = z
          .array(z.string())
          .parse(
            JSON.parse(
              await command([
                ...kubectl,
                "exec",
                name,
                "--",
                "python3",
                "-c",
                script,
                JSON.stringify(folders),
              ]),
            ),
          );
        return files.filter(
          (file) => FixtureFileSchema.safeParse(file).success,
        );
      },
      list: async (world, layer) => {
        if (
          !/^[a-z][a-z0-9_]*$/u.test(world) ||
          !["region", "entities", "poi"].includes(layer)
        )
          throw new Error("Invalid export path");
        const folder = `/snapshot/world/dimensions/minecraft/${worldFolder(world)}/${layer}`;
        const script =
          "import json,os,sys; p=sys.argv[1]; print(json.dumps(os.listdir(p) if os.path.isdir(p) else []))";
        return z
          .array(z.string())
          .parse(
            JSON.parse(
              await command([
                ...kubectl,
                "exec",
                name,
                "--",
                "python3",
                "-c",
                script,
                folder,
              ]),
            ),
          );
      },
      read: (file) => {
        FixtureFileSchema.parse(file);
        const script =
          "import os,sys; p=sys.argv[1]; assert os.path.realpath(p)==p and os.path.isfile(p), 'Linked fixture file'; sys.stdout.buffer.write(open(p,'rb').read())";
        return commandBytes([
          ...kubectl,
          "exec",
          name,
          "--",
          "python3",
          "-c",
          script,
          `/snapshot/world/${file}`,
        ]);
      },
    });
  } finally {
    await recoverExport(id);
  }
}
