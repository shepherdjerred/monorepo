import { describe, expect, test } from "vitest";
import { formatLoad } from "#lib/ci/load.ts";

const unavailable = { available: false, error: "no sample" } as const;
function admission(
  pending: number,
  admitted: number,
  cpu: string,
  reserved: string,
) {
  return {
    available: true as const,
    data: {
      spec: {
        resourceGroups: [
          {
            flavors: [
              {
                name: "default",
                resources: [{ name: "cpu", nominalQuota: cpu }],
              },
            ],
          },
        ],
      },
      status: {
        pendingWorkloads: pending,
        admittedWorkloads: admitted,
        flavorsReservation: [
          { name: "default", resources: [{ name: "cpu", total: reserved }] },
        ],
        flavorsUsage: [],
      },
    },
  };
}
const report = () => ({
  sampledAt: "2026-10-09T09:00:00.000Z",
  node: "liskov",
  queue: unavailable,
  admission: unavailable,
  gateAdmission: unavailable,
  cpu: unavailable,
  memory: unavailable,
  disk: unavailable,
  ioPressure: unavailable,
  pods: { available: true as const, data: [] },
  guidance: "Keep the same ci wait process running.",
});

describe("CI load for separate admission reserves", () => {
  test("reports compute and gate usage independently", () => {
    const formatted = formatLoad({
      ...report(),
      admission: admission(2, 8, "23", "20"),
      gateAdmission: admission(0, 3, "1", "750m"),
    });
    expect(formatted).toContain("Kueue woodpecker: 2 pending, 8 admitted");
    expect(formatted).toContain("cpu: 20 reserved / 23 quota");
    expect(formatted).toContain(
      "Kueue woodpecker-gates: 0 pending, 3 admitted",
    );
    expect(formatted).toContain("cpu: 750m reserved / 1 quota");
  });

  test("a missing reserve does not hide the available queue or invent zero usage", () => {
    const formatted = formatLoad({
      ...report(),
      admission: admission(1, 2, "23", "4"),
    });
    expect(formatted).toContain("Kueue woodpecker: 1 pending, 2 admitted");
    expect(formatted).toContain(
      "Kueue woodpecker-gates unavailable: no sample",
    );
    expect(formatted).not.toContain("Kueue woodpecker-gates: 0");
  });
});
