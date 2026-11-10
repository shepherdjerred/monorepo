import { App, Chart, Testing } from "cdk8s";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { onePasswordSecret, vaultItemPath } from "./onepassword-vault.ts";

const Item = z.object({
  apiVersion: z.literal("onepassword.com/v1"),
  kind: z.literal("OnePasswordItem"),
  metadata: z.object({ name: z.string(), namespace: z.string().optional() }),
  spec: z.object({ itemPath: z.string() }),
});

function synth(chart: Chart) {
  return Testing.synth(chart).map((document) => Item.parse(document));
}

describe("onePasswordSecret", () => {
  test("points at the item in the homelab vault", () => {
    const chart = Testing.chart();
    onePasswordSecret(chart, "plex-item", "example-item");
    const [item] = synth(chart);
    expect(item?.spec.itemPath).toBe(vaultItemPath("example-item"));
    expect(item?.spec.itemPath).toMatch(
      /^vaults\/[a-z0-9]+\/items\/example-item$/u,
    );
  });

  test("without metadata the Secret takes the chart's namespace and a name derived from the id", () => {
    const chart = new Chart(new App(), "media", { namespace: "media" });
    onePasswordSecret(chart, "plex-item", "example-item");
    const [item] = synth(chart);
    expect(item?.metadata.namespace).toBe("media");
    expect(item?.metadata.name).toContain("plex-item");
  });

  test("explicit metadata places the Secret where a consumer expects it", () => {
    const chart = new Chart(new App(), "apps", { namespace: "argocd" });
    onePasswordSecret(chart, "operator-oauth-1p", "example-item", {
      name: "operator-oauth",
      namespace: "tailscale",
    });
    const [item] = synth(chart);
    expect(item?.metadata).toEqual({
      name: "operator-oauth",
      namespace: "tailscale",
    });
  });

  test("returns the item so a workload can reference the Secret it produces", () => {
    const chart = Testing.chart();
    const item = onePasswordSecret(chart, "ddns-config", "example", {
      name: "ddns-config",
    });
    expect(item.name).toBe("ddns-config");
  });
});
