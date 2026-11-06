import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { command, commandBytes } from "./process.ts";
import { worldFolder, type FixtureSource } from "./fixture.ts";

const namespace = "minecraft-tsmc";
const kubectl = ["kubectl", "-n", namespace];
const ClaimSchema = z.object({spec: z.object({resources: z.object({requests: z.object({storage: z.string()})})})});
const PodSchema = z.object({status: z.object({containerStatuses: z.array(z.object({name: z.string(), imageID: z.string()}))})});
const OwnedSchema = z.object({metadata: z.object({uid: z.string(), labels: z.record(z.string(), z.string())})});

async function deleteOwned(name: string, owner: string): Promise<void> {
  for (const kind of ["pod", "pvc", "volumesnapshot"]) {
    const raw = await command([...kubectl, "get", kind, name, "--ignore-not-found", "-o", "json"]);
    if (raw.trim() === "") continue;
    const object = OwnedSchema.parse(JSON.parse(raw));
    if (object.metadata.labels["sjer.red/mc-capture"] !== owner)
      throw new Error(`Refusing cleanup of unowned ${kind}/${name}`);
    // Generated UUID names are never reused. Read back ownership before every deletion.
    await command([...kubectl, "delete", kind, name, "--wait=true", "--timeout=60s"]);
  }
}

/** A stable read view; the source PVC is never mounted by the export pod. */
export async function withLiveFixture<T>(repoRoot: string, action: (source: FixtureSource) => Promise<T>): Promise<T> {
  z.object({reclaimPolicy: z.literal("Delete"), provisioner: z.literal("zfs.csi.openebs.io")}).parse(
    JSON.parse(await command(["kubectl", "get", "storageclass", "mc-capture-fixture", "-o", "json"])));
  const claim = ClaimSchema.parse(JSON.parse(await command([...kubectl, "get", "pvc", "datadir-minecraft-tsmc-0", "-o", "json"])));
  const pod = PodSchema.parse(JSON.parse(await command([...kubectl, "get", "pod", "minecraft-tsmc-0", "-o", "json"])));
  const container = pod.status.containerStatuses.find(c => c.name === "minecraft-tsmc");
  if (container === undefined) throw new Error("Live Minecraft container is unavailable");
  const image = container.imageID.replace(/^docker-pullable:\/\//u, "");
  const id = randomUUID(), name = `mc-capture-${id}`;
  const resources = await command(["bun", path.join(repoRoot, "packages/homelab/scripts/minecraft/capture-resources.ts")],
    JSON.stringify({id, sourceClaim: "datadir-minecraft-tsmc-0", capacity: claim.spec.resources.requests.storage, image}));
  await command(["bun", path.join(repoRoot, "packages/toolkit/src/index.ts"), "mc", "cmd", "--target", "live", "--reason", "Flush saved terrain before bounded documentation export", "minecraft:save-all", "flush"]);
  try {
    await command([...kubectl, "create", "-f", "-"], resources);
    await command([...kubectl, "wait", `volumesnapshot/${name}`, "--for=jsonpath={.status.readyToUse}=true", "--timeout=120s"]);
    await command([...kubectl, "wait", `pod/${name}`, "--for=condition=Ready", "--timeout=120s"]);
    return await action({id: `csi:${namespace}/${name}`,
      list: async (world, layer) => {
        if (!/^[a-z][a-z0-9_]*$/u.test(world) || !["region", "entities", "poi"].includes(layer)) throw new Error("Invalid export path");
        const folder = `/snapshot/world/dimensions/minecraft/${worldFolder(world)}/${layer}`;
        const script = "import json,os,sys; p=sys.argv[1]; print(json.dumps(os.listdir(p) if os.path.isdir(p) else []))";
        return z.array(z.string()).parse(JSON.parse(await command([...kubectl, "exec", name, "--", "python3", "-c", script, folder])));
      },
      read: file => {
        if (!/^(?:level\.dat|dimensions\/minecraft\/[a-z][a-z0-9_]*\/(?:region|entities|poi)\/r\.-?\d+\.-?\d+\.mca)$/u.test(file)) throw new Error("Invalid export file");
        return commandBytes([...kubectl, "exec", name, "--", "cat", `/snapshot/world/${file}`]);
      },
    });
  } finally { await deleteOwned(name, id); }
}
