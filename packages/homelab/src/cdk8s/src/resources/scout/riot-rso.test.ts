import { describe, expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { createScoutDeployment } from "./index.ts";
import { scoutRoleContainers } from "@shepherdjerred/homelab/cdk8s/src/testing/scout-role-containers.ts";

describe("Riot credential bootstrap", () => {
  test.each(["beta", "prod"] as const)(
    "%s grants required credentials only to the web application when provisioned",
    (stage) => {
      for (const { role, env } of scoutRoleContainers(stage, {
        riotSignOnProvisioned: true,
      })) {
        const credentials = env.filter((entry) =>
          entry.name.startsWith("RIOT_RSO_"),
        );
        if (role !== "application") {
          expect(credentials).toEqual([]);
          continue;
        }
        expect(credentials.map((entry) => entry.name).sort()).toEqual([
          "RIOT_RSO_CLIENT_ID",
          "RIOT_RSO_CLIENT_SECRET",
        ]);
        for (const credential of credentials) {
          expect(credential.value).toBeUndefined();
          expect(credential.valueFrom?.secretKeyRef).toEqual({
            name: `scout-${stage}-scout-for-lol-1p`,
            key: credential.name,
          });
        }
      }
    },
  );
  test("unprovisioned stages emit no references to missing credential fields", () => {
    const app = new App();
    createScoutDeployment(
      new Chart(app, "scout-beta", { namespace: "scout-beta" }),
      "beta",
      { riotSignOnProvisioned: false },
    );
    expect(app.synthYaml()).not.toContain("RIOT_RSO_CLIENT");
  });
});
