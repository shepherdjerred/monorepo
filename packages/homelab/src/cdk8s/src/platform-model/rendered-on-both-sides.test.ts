import { beforeAll, describe, expect, test } from "vitest";
import { platformDefinitions } from "homelab/src/platform-model.ts";
import { againstDebt } from "@shepherdjerred/homelab/cdk8s/src/fleet-policy/fleet.ts";
import { DEBT } from "./debt-allowlists.ts";
import { readKubernetesSide } from "./kubernetes-side.ts";
import { readOpenTofuSide } from "./opentofu-side.ts";
import { RULES, type Sides } from "./rules.ts";

/**
 * Every definition in the platform model is rendered by both synthesizers:
 * the cdk8s manifests and the OpenTofu stacks. A hostname with a
 * TunnelBinding and no DNS record fails here, and so does the reverse.
 *
 * cdk8s reads the model, so its half of each rule is "every definition is
 * rendered". The cloudflare stack reads it too, for tunnel CNAMEs and cache
 * rules; the other OpenTofu stacks do not yet. Every stack is compared value
 * by value from the JSON OpenTofu runs, so a record written outside the model
 * is caught either way.
 *
 * Each rule holds except for the entries in `debt-allowlists.ts`, asserted in
 * both directions: nothing outside the allowlist may break the rule, and
 * nothing inside it may satisfy it. Fix the disagreement, then delete its
 * entry.
 */

let sides: Sides;
beforeAll(async () => {
  const [kubernetes, openTofu] = await Promise.all([
    readKubernetesSide(),
    readOpenTofuSide(),
  ]);
  sides = { definitions: platformDefinitions(), kubernetes, openTofu };
});

describe("the platform model is rendered on both sides", () => {
  test.each(RULES.map((rule) => [rule.name, rule] as const))(
    "%s",
    (_name, rule) => {
      const { unexpected, stale } = againstDebt(
        rule.violations(sides),
        DEBT[rule.id],
      );
      expect({ unexpected, stale }).toEqual({ unexpected: [], stale: [] });
    },
  );

  test("both renderings were read", () => {
    // An empty side would satisfy every "without definition" rule.
    expect(sides.kubernetes.tunnelBindings.length).toBeGreaterThan(0);
    expect(sides.kubernetes.caddySites.length).toBeGreaterThan(0);
    expect(sides.kubernetes.tailnetDevices.length).toBeGreaterThan(0);
    expect(sides.kubernetes.onePasswordItems.length).toBeGreaterThan(0);
    expect(sides.openTofu.tunnelRecords.length).toBeGreaterThan(0);
    expect(sides.openTofu.seaweedfsBuckets.size).toBeGreaterThan(0);
    expect(sides.openTofu.tailscaleTags.size).toBeGreaterThan(0);
    expect(sides.openTofu.onePasswordItems.length).toBeGreaterThan(0);
    expect(sides.openTofu.stateBackendEndpoints.length).toBeGreaterThan(0);
  });
});
