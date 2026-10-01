import { describe, expect, it } from "vitest";
import { dnsAuditActivities } from "./dns-audit.ts";

describe("dnsAuditActivities", () => {
  describe("getDomains", () => {
    it("audits all ten onboarded domains as email domains", async () => {
      const result = await dnsAuditActivities.getDomains();

      expect(result.emailDomains.toSorted()).toEqual([
        "better-skill-capped.com",
        "clauderon.com",
        "discord-plays-pokemon.com",
        "glitter-boys.com",
        "jerredshepherd.com",
        "scout-for-lol.com",
        "shepherdjerred.com",
        "sjer.red",
        "statically-typed.com",
        "ts-mc.net",
      ]);
      expect(result.noEmailDomains).toEqual([]);
    });
  });

  describe("checkDomain", () => {
    it("checks sjer.red DNS records", async () => {
      const result = await dnsAuditActivities.checkDomain("sjer.red", false);

      expect(result.domain).toBe("sjer.red");
      expect(result.parked).toBe(false);
      expect(result.spf.status).toBeDefined();
      expect(result.dmarc.status).toBeDefined();
      expect(result.mx.status).toBeDefined();
    });

    it("checks a parked domain", async () => {
      const result = await dnsAuditActivities.checkDomain(
        "shepherdjerred.com",
        true,
      );

      expect(result.domain).toBe("shepherdjerred.com");
      expect(result.parked).toBe(true);
    });
  });

  describe("logAuditResults", () => {
    it("logs results as JSON", async () => {
      const warnings: string[] = [];
      const original = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(String(args[0]));
      };

      try {
        await dnsAuditActivities.logAuditResults([
          {
            domain: "example.com",
            parked: false,
            spf: { status: "ok", message: "SPF valid" },
            dmarc: { status: "ok", message: "DMARC valid" },
            mx: { status: "ok", message: "MX valid" },
          },
        ]);

        expect(warnings).toHaveLength(1);
        const parsed: unknown = JSON.parse(warnings[0] ?? "{}");
        expect(parsed).toMatchObject({
          domain: "example.com",
          level: "info",
        });
      } finally {
        console.warn = original;
      }
    });
  });
});
