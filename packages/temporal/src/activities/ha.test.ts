import { describe, expect, it } from "bun:test";
import { haActivities } from "./ha.ts";

describe("haActivities", () => {
  it("throws when HA_URL is not set", async () => {
    const originalUrl = Bun.env["HA_URL"];
    const originalToken = Bun.env["HA_TOKEN"];
    delete Bun.env["HA_URL"];
    delete Bun.env["HA_TOKEN"];

    try {
      await expect(haActivities.getEntityState("person.test")).rejects.toThrow(
        "HA_URL environment variable is required",
      );
    } finally {
      if (originalUrl !== undefined) {
        Bun.env["HA_URL"] = originalUrl;
      }
      if (originalToken !== undefined) {
        Bun.env["HA_TOKEN"] = originalToken;
      }
    }
  });

  it("throws when HA_TOKEN is not set", async () => {
    const originalUrl = Bun.env["HA_URL"];
    const originalToken = Bun.env["HA_TOKEN"];
    Bun.env["HA_URL"] = "http://localhost:8123";
    delete Bun.env["HA_TOKEN"];

    try {
      await expect(haActivities.getEntityState("person.test")).rejects.toThrow(
        "HA_TOKEN environment variable is required",
      );
    } finally {
      if (originalUrl !== undefined) {
        Bun.env["HA_URL"] = originalUrl;
      } else {
        delete Bun.env["HA_URL"];
      }
      if (originalToken !== undefined) {
        Bun.env["HA_TOKEN"] = originalToken;
      }
    }
  });
});
