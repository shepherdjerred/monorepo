import { describe, expect, it } from "bun:test";
import { homelabAuditActivities } from "./homelab-audit.ts";

describe("homelabAuditActivities", () => {
  it("exposes the agent and email activities the workflow proxies", () => {
    expect(typeof homelabAuditActivities.runHomelabAuditAgent).toBe("function");
    expect(typeof homelabAuditActivities.sendHomelabAuditEmail).toBe(
      "function",
    );
  });
});
