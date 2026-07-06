import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  Cpu,
  DaemonSet,
  Namespace,
  Node,
  NodeLabelQuery,
  Probe,
  ServiceAccount,
  Volume,
} from "cdk8s-plus-31";
import { z } from "zod";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const CpuPowerCapOptionsSchema = z
  .object({
    /**
     * Sustained ("PL1") package power limit in watts — the long-term ceiling
     * the cooling system must dissipate continuously.
     */
    pl1Watts: z.number().positive(),
    /**
     * Short-burst ("PL2" / MTP) package power limit in watts. The CPU may
     * draw up to this for the brief PL2 time window (~28 s default) before
     * being clamped back to PL1. Must be >= pl1Watts.
     */
    pl2Watts: z.number().positive(),
  })
  .refine((value) => value.pl2Watts >= value.pl1Watts, {
    message: "pl2Watts must be >= pl1Watts",
    path: ["pl2Watts"],
  });

export type CpuPowerCapOptions = z.input<typeof CpuPowerCapOptionsSchema>;

const NAMESPACE = "node-tuning";
// The 125 W / 253 W limits are Intel stock for the i9-14900K in this host. If
// another node ever joins the cluster the limits would be wrong for it, and
// the DaemonSet would CrashLoopBackOff there anyway because non-Intel hosts
// lack /sys/class/powercap/intel-rapl:0. Pin to torvalds explicitly.
const TARGET_NODE_HOSTNAME = "torvalds";

/**
 * Caps Intel RAPL package power limits (PL1/PL2) on every node via a
 * privileged DaemonSet. Writes
 * /sys/class/powercap/intel-rapl:0/constraint_{0,1}_power_limit_uw on startup
 * and re-applies every 5 minutes as a safety net against firmware resets or
 * userspace clobbering.
 *
 * Why this exists: torvalds runs an i9-14900K on an ASUS Pro Q670M-C whose
 * firmware defaults PL1 to *unlimited*. Left unguarded that drove sustained
 * 100 °C TJMax under bursty Buildkite CI load and overheated the physically
 * adjacent M.2 slots (nvme1 NAND once hit ~104 °C). A large AIO cooler plus
 * per-drive NVMe cooling (installed 2026-05-26) resolved the thermals — heavy
 * CI days now peak ~82–84 °C — so on 2026-06-12 the emergency 95/140 W cap was
 * raised to Intel stock 125/253 W. The DaemonSet is retained purely as a guard
 * that re-pins the stock limits every 5 min so a firmware reset can't silently
 * restore the unlimited-PL1 default.
 *
 * Note: this caps power, not voltage. Vcore undervolting on 10th-gen+ Intel
 * is blocked in microcode (Plundervolt mitigation, CVE-2019-11157) and must
 * be done in BIOS. RAPL writes are independent of that mitigation and
 * reliably work without a BIOS change.
 *
 * If the firmware locks RAPL via MSR 0x610 (rare on consumer boards), the
 * read-back check will see a rejected write and the pod will
 * CrashLoopBackOff with a visible error.
 */
export function createCpuPowerCap(chart: Chart, options: CpuPowerCapOptions) {
  const { pl1Watts, pl2Watts } = CpuPowerCapOptionsSchema.parse(options);

  const namespace = new Namespace(chart, "node-tuning-namespace", {
    metadata: {
      name: NAMESPACE,
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

  const serviceAccount = new ServiceAccount(
    chart,
    "cpu-power-cap-service-account",
    {
      metadata: {
        name: "cpu-power-cap",
        namespace: NAMESPACE,
      },
    },
  );

  const daemonSet = new DaemonSet(chart, "cpu-power-cap-daemonset", {
    metadata: {
      name: "cpu-power-cap",
      namespace: NAMESPACE,
      labels: { app: "cpu-power-cap" },
      annotations: {
        "ignore-check.kube-linter.io/sensitive-host-mounts":
          "Required to write Intel RAPL limits via /sys/class/powercap",
        "ignore-check.kube-linter.io/privileged-container":
          "Required to write Intel RAPL limits via /sys/class/powercap",
        "ignore-check.kube-linter.io/privilege-escalation-container":
          "Required when privileged is true",
        "ignore-check.kube-linter.io/run-as-non-root":
          "Required to write /sys/class/powercap",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Required for shell scratch state",
      },
    },
    serviceAccount,
    securityContext: {
      ensureNonRoot: false,
      fsGroup: 0,
    },
  });

  daemonSet.scheduling.attract(
    Node.labeled(
      NodeLabelQuery.is("kubernetes.io/hostname", TARGET_NODE_HOSTNAME),
    ),
  );

  const pl1Uw = String(pl1Watts * 1_000_000);
  const pl2Uw = String(pl2Watts * 1_000_000);
  const raplPath = "/host/sys/class/powercap/intel-rapl:0";

  const container = daemonSet.addContainer({
    name: "cpu-power-cap",
    image: `docker.io/alpine:${versions["library/alpine"]}`,
    command: ["/bin/sh"],
    args: [
      "-c",
      `
set -eu

RAPL="${raplPath}"
PL1_UW=${pl1Uw}
PL2_UW=${pl2Uw}

if [ ! -d "$RAPL" ]; then
  echo "FATAL: $RAPL not found. Intel RAPL package domain unavailable. Kernel module intel_rapl_msr / intel_rapl_common may be missing." >&2
  exit 1
fi

apply() {
  echo "Applying Intel RAPL package limits: PL1=$((PL1_UW/1000000))W PL2=$((PL2_UW/1000000))W"

  echo "$PL1_UW" > "$RAPL/constraint_0_power_limit_uw"
  actual_pl1=$(cat "$RAPL/constraint_0_power_limit_uw")
  if [ "$actual_pl1" != "$PL1_UW" ]; then
    echo "FATAL: PL1 write rejected. wanted=$PL1_UW actual=$actual_pl1. RAPL is likely firmware-locked (MSR 0x610 lock bit) — check BIOS." >&2
    exit 1
  fi

  echo "$PL2_UW" > "$RAPL/constraint_1_power_limit_uw"
  actual_pl2=$(cat "$RAPL/constraint_1_power_limit_uw")
  if [ "$actual_pl2" != "$PL2_UW" ]; then
    echo "FATAL: PL2 write rejected. wanted=$PL2_UW actual=$actual_pl2." >&2
    exit 1
  fi

  echo "OK: PL1=$actual_pl1 PL2=$actual_pl2"
}

while true; do
  apply
  sleep 300
done
      `.trim(),
    ],
    liveness: Probe.fromCommand(
      [
        "sh",
        "-c",
        `actual_pl1=$(cat ${raplPath}/constraint_0_power_limit_uw) && [ "$actual_pl1" = "${pl1Uw}" ] && actual_pl2=$(cat ${raplPath}/constraint_1_power_limit_uw) && [ "$actual_pl2" = "${pl2Uw}" ]`,
      ],
      {
        initialDelaySeconds: Duration.seconds(30),
        periodSeconds: Duration.seconds(60),
        failureThreshold: 3,
      },
    ),
    resources: {
      cpu: {
        request: Cpu.millis(10),
        limit: Cpu.millis(100),
      },
      memory: {
        request: Size.mebibytes(16),
        limit: Size.mebibytes(64),
      },
    },
    securityContext: {
      privileged: true,
      allowPrivilegeEscalation: true,
      ensureNonRoot: false,
      readOnlyRootFilesystem: false,
      user: 0,
      group: 0,
    },
  });

  const hostSysVolume = Volume.fromHostPath(
    chart,
    "cpu-power-cap-host-sys",
    "cpu-power-cap-host-sys",
    {
      path: "/sys",
    },
  );
  daemonSet.addVolume(hostSysVolume);
  container.mount("/host/sys", hostSysVolume, { readOnly: false });

  return { namespace, serviceAccount, daemonSet };
}
