import { z } from "zod";
import {
  getPvcBackupLabels,
  PVC_BACKUP_POLICY,
  pvcBackupPolicyKey,
} from "@shepherdjerred/homelab/cdk8s/src/backup-policy/pvc-backup-policy.ts";

const PvcListSchema = z.object({
  items: z.array(
    z.object({
      metadata: z.object({
        namespace: z.string().min(1),
        name: z.string().min(1),
        labels: z.record(z.string(), z.string()).optional(),
      }),
    }),
  ),
});

const apply = Bun.argv.slice(2).includes("--apply");
const unexpectedArguments = Bun.argv
  .slice(2)
  .filter((argument) => argument !== "--apply");
if (unexpectedArguments.length > 0) {
  throw new Error(
    `Unknown arguments: ${unexpectedArguments.join(", ")}. Supported: --apply`,
  );
}

async function runKubectl(args: readonly string[]): Promise<string> {
  const command = ["kubectl", ...args];
  const process = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} exited ${String(exitCode)}: ${stderr.trim() || stdout.trim() || "(no output)"}`,
    );
  }
  return stdout;
}

const liveJson: unknown = JSON.parse(
  await runKubectl(["get", "pvc", "-A", "-o", "json"]),
);
const live = PvcListSchema.parse(liveJson);
const liveByKey = new Map(
  live.items.map(
    (pvc) =>
      [
        pvcBackupPolicyKey(pvc.metadata.namespace, pvc.metadata.name),
        pvc,
      ] as const,
  ),
);
const policyByKey = new Map(
  PVC_BACKUP_POLICY.map(
    (entry) =>
      [pvcBackupPolicyKey(entry.namespace, entry.name), entry] as const,
  ),
);

const unknownLivePvcs = [...liveByKey.keys()].filter(
  (key) => !policyByKey.has(key),
);
const missingLivePvcs = [...policyByKey.keys()].filter(
  (key) => !liveByKey.has(key),
);
if (unknownLivePvcs.length > 0 || missingLivePvcs.length > 0) {
  throw new Error(
    [
      "Live PVC inventory does not exactly match the backup policy; no labels were changed.",
      `Unknown live PVCs: ${unknownLivePvcs.join(", ") || "(none)"}`,
      `Policy entries absent from the cluster: ${missingLivePvcs.join(", ") || "(none)"}`,
    ].join("\n"),
  );
}

const changes = PVC_BACKUP_POLICY.flatMap((entry) => {
  const key = pvcBackupPolicyKey(entry.namespace, entry.name);
  const pvc = liveByKey.get(key);
  if (pvc === undefined) {
    throw new Error(`PVC ${key} disappeared after inventory validation`);
  }
  const labels = getPvcBackupLabels(entry);
  const currentLabels = pvc.metadata.labels ?? {};
  if (
    currentLabels["velero.io/backup"] === labels["velero.io/backup"] &&
    currentLabels["velero.io/exclude-from-backup"] ===
      labels["velero.io/exclude-from-backup"]
  ) {
    return [];
  }
  return [{ entry, labels }];
});

console.log(
  `${apply ? "Applying" : "Would apply"} backup policy labels to ${String(changes.length)} of ${String(PVC_BACKUP_POLICY.length)} PVCs`,
);

for (const change of changes) {
  const args = [
    "label",
    "pvc",
    change.entry.name,
    "--namespace",
    change.entry.namespace,
    `velero.io/backup=${change.labels["velero.io/backup"]}`,
    `velero.io/exclude-from-backup=${change.labels["velero.io/exclude-from-backup"]}`,
    "--overwrite",
  ];
  if (!apply) {
    args.push("--dry-run=server", "-o", "name");
  }
  const output = await runKubectl(args);
  console.log(
    `${pvcBackupPolicyKey(change.entry.namespace, change.entry.name)}: ${output.trim()}`,
  );
}

if (!apply) {
  console.log(
    "Dry run complete. Re-run with --apply after the admission policies are deployed.",
  );
}
