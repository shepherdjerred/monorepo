import { describe, expect, test } from "vitest";
import { scoutRoleContainers } from "@shepherdjerred/homelab/cdk8s/src/testing/scout-role-containers.ts";

describe("Scout operations machine credential", () => {
  test.each(["beta", "prod"] as const)(
    "%s grants the required token only to the application role that serves the API",
    (stage) => {
      let applicationContainers = 0;
      for (const { role, env } of scoutRoleContainers(stage)) {
        const token = env.filter(
          (entry) => entry.name === "SCOUT_OPERATIONS_TOKEN",
        );
        if (role !== "application") {
          expect(token).toEqual([]);
          continue;
        }
        applicationContainers += 1;
        expect(token).toHaveLength(1);
        expect(token[0]?.value).toBeUndefined();
        expect(token[0]?.valueFrom?.secretKeyRef).toEqual({
          name: `scout-${stage}-scout-for-lol-1p`,
          key: "SCOUT_OPERATIONS_TOKEN",
        });
      }
      expect(applicationContainers).toBe(1);
    },
  );
});
