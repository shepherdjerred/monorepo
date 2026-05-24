import type { Chart } from "cdk8s";
import { Duration } from "cdk8s";
import {
  DaemonSet,
  Namespace,
  Probe,
  ServiceAccount,
  Volume,
} from "cdk8s-plus-31";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export type CpuPowerCapOptions = {
  /**
   * Sustained ("PL1") package power limit in watts — the long-term ceiling
   * the cooling system must dissipate continuously.
   */
  pl1Watts: number;
  /**
   * Short-burst ("PL2" / MTP) package power limit in watts. The CPU may draw
   * up to this for the brief PL2 time window (~28 s default) before being
   * clamped back to PL1. Must be >= pl1Watts.
   */
  pl2Watts: number;
};

const NAMESPACE = "node-tuning";

/**
 * Caps Intel RAPL package power limits (PL1/PL2) on every node via a
 * privileged DaemonSet. Writes
 * /sys/class/powercap/intel-rapl:0/constraint_{0,1}_power_limit_uw on startup
 * and re-applies every 5 minutes as a safety net against firmware resets or
 * userspace clobbering.
 *
 * Why this exists: the i9-13900K in `torvalds` thermally throttles at TJMax
 * (100 °C) under bursty Buildkite CI load. The NVMe drives sit physically
 * adjacent to the CPU on the ASUS Pro Q670M-C and inherit the radiated heat —
 * nvme1 Composite has crossed its 81.85 °C warning threshold and its NAND
 * sensor has hit 103.85 °C. Capping CPU package power reduces radiated heat
 * into the SSD slot.
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
  const { pl1Watts, pl2Watts } = options;

  if (pl2Watts < pl1Watts) {
    throw new Error(
      `cpu-power-cap: pl2Watts (${String(pl2Watts)}) must be >= pl1Watts (${String(pl1Watts)})`,
    );
  }

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
        `actual=$(cat ${raplPath}/constraint_0_power_limit_uw) && [ "$actual" = "${pl1Uw}" ]`,
      ],
      {
        initialDelaySeconds: Duration.seconds(30),
        periodSeconds: Duration.seconds(60),
        failureThreshold: 3,
      },
    ),
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
