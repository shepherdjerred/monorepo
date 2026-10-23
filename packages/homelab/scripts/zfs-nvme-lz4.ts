/**
 * One-shot: turn on lz4 for the existing uncompressed datasets on the
 * production NVMe pool (node torvalds, pool zfspv-pool-nvme).
 *
 * The change goes through each OpenEBS `ZFSVolume` CR, never a bare
 * `zfs set`: the ZFS LocalPV node agent re-applies every property in the CR
 * when it restarts, so a dataset set by hand would fall back to the CR's
 * `compression: off`. `spec.compression` is editable after creation; the
 * agent runs `zfs set compression=lz4` on the update. Only data written
 * afterwards is compressed, and PVC manifests do not change.
 *
 * A dataset is a candidate when its live `compression` property is `off` and
 * its CR says `off` or leaves compression unset (older and restored volumes
 * carry no field, yet their datasets were created with a local `off`).
 *
 * Dry run by default: it prints the plan and validates each patch with a
 * server-side dry run. `--apply` patches, then reads back both the CR field
 * and the live dataset property, and exits non-zero unless every candidate
 * reads back lz4.
 *
 *   bun scripts/zfs-nvme-lz4.ts            # plan + server-side dry run
 *   bun scripts/zfs-nvme-lz4.ts --apply    # patch and read back
 *
 * How-to: packages/docs/wiki/src/content/docs/how-to/enable-lz4-on-nvme-volumes.md
 */
import { z } from "zod";

export const TARGET_NODE = "torvalds";
export const TARGET_POOL = "zfspv-pool-nvme";
const NAMESPACE = "openebs";
const PLUGIN_CONTAINER = "openebs-zfs-plugin";
const READBACK_TIMEOUT_MS = 120_000;
const READBACK_INTERVAL_MS = 3000;

const ZfsVolumeSchema = z.object({
  metadata: z.object({
    name: z.string().min(1),
    deletionTimestamp: z.string().optional(),
  }),
  spec: z.object({
    ownerNodeID: z.string(),
    poolName: z.string(),
    volumeType: z.string(),
    compression: z.string().optional(),
  }),
  status: z.object({ state: z.string().optional() }).optional(),
});
export type ZfsVolume = z.infer<typeof ZfsVolumeSchema>;
const ZfsVolumeListSchema = z.object({ items: z.array(ZfsVolumeSchema) });

const PersistentVolumeListSchema = z.object({
  items: z.array(
    z.object({
      metadata: z.object({ name: z.string() }),
      spec: z.object({
        claimRef: z
          .object({ namespace: z.string(), name: z.string() })
          .optional(),
      }),
    }),
  ),
});

const PodListSchema = z.object({
  items: z.array(
    z.object({
      metadata: z.object({ name: z.string() }),
      status: z.object({ phase: z.string() }),
    }),
  ),
});

export type Plan = {
  candidates: ZfsVolume[];
  skipped: { volume: ZfsVolume; reason: string }[];
};

export function datasetName(volume: ZfsVolume): string {
  return `${volume.spec.poolName}/${volume.metadata.name}`;
}

/**
 * Chooses the torvalds NVMe datasets to move to lz4. `liveCompression` maps a
 * dataset name to its live `zfs get compression` value.
 */
export function planLz4(
  volumes: readonly ZfsVolume[],
  liveCompression: ReadonlyMap<string, string>,
): Plan {
  const plan: Plan = { candidates: [], skipped: [] };
  for (const volume of volumes) {
    if (!inScope(volume)) continue;
    const reason = skipReason(volume, liveCompression);
    if (reason === undefined) plan.candidates.push(volume);
    else plan.skipped.push({ volume, reason });
  }
  return plan;
}

function inScope(volume: ZfsVolume): boolean {
  return (
    volume.spec.ownerNodeID === TARGET_NODE &&
    volume.spec.poolName === TARGET_POOL
  );
}

function skipReason(
  volume: ZfsVolume,
  liveCompression: ReadonlyMap<string, string>,
): string | undefined {
  if (volume.metadata.deletionTimestamp !== undefined) return "being deleted";
  const state = volume.status?.state;
  if (state !== "Ready") return `state ${state ?? "unset"}, not Ready`;
  if (volume.spec.volumeType !== "DATASET")
    return `volume type ${volume.spec.volumeType}`;
  const declared = volume.spec.compression;
  if (declared !== undefined && declared !== "off")
    return `CR already declares compression=${declared}`;
  const live = liveCompression.get(datasetName(volume));
  if (live === undefined) return "dataset not found on the pool";
  return live === "off" ? undefined : `live compression is already ${live}`;
}

export function parseArguments(argv: readonly string[]): { apply: boolean } {
  const unknown = argv.filter((argument) => argument !== "--apply");
  if (unknown.length > 0) {
    throw new Error(
      `Unknown arguments: ${unknown.join(", ")}. Supported: --apply`,
    );
  }
  return { apply: argv.includes("--apply") };
}

/** Parses `zfs get -H -o name,value compression` output. */
export function parseZfsGet(output: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of output.split("\n")) {
    if (line.trim() === "") continue;
    const [name, value, ...rest] = line.split("\t");
    if (name === undefined || value === undefined || rest.length > 0) {
      throw new Error(`Unexpected zfs get line: ${JSON.stringify(line)}`);
    }
    values.set(name, value);
  }
  return values;
}

async function kubectl(args: readonly string[]): Promise<string> {
  const command = ["kubectl", ...args];
  const child = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} exited ${String(exitCode)}: ${stderr.trim() || stdout.trim() || "(no output)"}`,
    );
  }
  return stdout;
}

async function readVolumes(): Promise<ZfsVolume[]> {
  const output = await kubectl([
    "get",
    "zfsvolumes.zfs.openebs.io",
    "--namespace",
    NAMESPACE,
    "-o",
    "json",
  ]);
  return ZfsVolumeListSchema.parse(JSON.parse(output)).items;
}

async function nodePluginPod(): Promise<string> {
  const output = await kubectl([
    "get",
    "pods",
    "--namespace",
    NAMESPACE,
    "--selector",
    "app=openebs-zfs-node",
    "--field-selector",
    `spec.nodeName=${TARGET_NODE}`,
    "-o",
    "json",
  ]);
  const running = PodListSchema.parse(JSON.parse(output)).items.filter(
    (pod) => pod.status.phase === "Running",
  );
  const [pod, ...extra] = running;
  if (pod === undefined || extra.length > 0) {
    throw new Error(
      `Expected one running ZFS node plugin pod on ${TARGET_NODE}, found ${String(running.length)}`,
    );
  }
  return pod.metadata.name;
}

async function readLiveCompression(
  pod: string,
  datasets: readonly string[],
): Promise<Map<string, string>> {
  if (datasets.length === 0) return new Map();
  const output = await kubectl([
    "exec",
    "--namespace",
    NAMESPACE,
    pod,
    "--container",
    PLUGIN_CONTAINER,
    "--",
    "zfs",
    "get",
    "-H",
    "-o",
    "name,value",
    "compression",
    ...datasets,
  ]);
  return parseZfsGet(output);
}

async function claimsByVolume(): Promise<Map<string, string>> {
  const output = await kubectl(["get", "pv", "-o", "json"]);
  return new Map(
    PersistentVolumeListSchema.parse(JSON.parse(output)).items.map((pv) => [
      pv.metadata.name,
      pv.spec.claimRef === undefined
        ? "(unbound)"
        : `${pv.spec.claimRef.namespace}/${pv.spec.claimRef.name}`,
    ]),
  );
}

function patchArgs(volume: ZfsVolume, dryRun: boolean): string[] {
  return [
    "patch",
    "zfsvolumes.zfs.openebs.io",
    volume.metadata.name,
    "--namespace",
    NAMESPACE,
    "--type",
    "merge",
    "--patch",
    JSON.stringify({ spec: { compression: "lz4" } }),
    ...(dryRun ? ["--dry-run=server"] : []),
    "-o",
    "name",
  ];
}

async function readBack(
  pod: string,
  candidates: readonly ZfsVolume[],
): Promise<string[]> {
  const deadline = Date.now() + READBACK_TIMEOUT_MS;
  for (;;) {
    const current = await readVolumes();
    const volumes = new Map(
      current.map((volume) => [volume.metadata.name, volume]),
    );
    const live = await readLiveCompression(
      pod,
      candidates.map((volume) => datasetName(volume)),
    );
    const pending = candidates.flatMap((volume) => {
      const declared = volumes.get(volume.metadata.name)?.spec.compression;
      const actual = live.get(datasetName(volume));
      return declared === "lz4" && actual === "lz4"
        ? []
        : [
            `${datasetName(volume)}: CR ${declared ?? "unset"}, dataset ${actual ?? "missing"}`,
          ];
    });
    if (pending.length === 0 || Date.now() >= deadline) return pending;
    await Bun.sleep(READBACK_INTERVAL_MS);
  }
}

async function main(): Promise<void> {
  const { apply } = parseArguments(Bun.argv.slice(2));
  const [volumes, pod, claims] = await Promise.all([
    readVolumes(),
    nodePluginPod(),
    claimsByVolume(),
  ]);
  const targeted = volumes.filter((volume) => inScope(volume));
  const live = await readLiveCompression(
    pod,
    targeted.map((volume) => datasetName(volume)),
  );
  const plan = planLz4(volumes, live);

  const describe = (volume: ZfsVolume) =>
    `${datasetName(volume)}  ${claims.get(volume.metadata.name) ?? "(no PV)"}  CR=${volume.spec.compression ?? "unset"}`;
  console.log(
    `${TARGET_NODE}/${TARGET_POOL}: ${String(targeted.length)} volumes, ${String(plan.candidates.length)} to move to lz4, ${String(plan.skipped.length)} skipped`,
  );
  for (const volume of plan.candidates)
    console.log(`  lz4   ${describe(volume)}`);
  for (const { volume, reason } of plan.skipped)
    console.log(`  skip  ${describe(volume)}  (${reason})`);

  for (const volume of plan.candidates) {
    const output = await kubectl(patchArgs(volume, !apply));
    console.log(`${apply ? "patched" : "dry-run ok"}: ${output.trim()}`);
  }
  if (!apply) {
    console.log("Dry run complete; nothing changed. Re-run with --apply.");
    return;
  }

  const pending = await readBack(pod, plan.candidates);
  if (pending.length > 0) {
    throw new Error(
      `Read-back did not show lz4 for ${String(pending.length)} dataset(s):\n${pending.join("\n")}`,
    );
  }
  console.log(
    `Read back lz4 on ${String(plan.candidates.length)} dataset(s), in both the CR and zfs get.`,
  );
}

if (import.meta.main) {
  await main();
}
