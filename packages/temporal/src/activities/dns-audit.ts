import { promises as dns } from "node:dns";
import type { DnsCheckResult, DnsRecordResult } from "#shared/types.ts";

// Domain lists — these match the values from the homelab cdk8s dns-audit chart.
// They are loaded as activity inputs so the workflow stays deterministic.
const EMAIL_DOMAINS = ["sjer.red", "ts-mc.net"];

const NO_EMAIL_DOMAINS = [
  "shepherdjerred.com",
  "scout-for-lol.com",
  "better-skill-capped.com",
  "discord-plays-pokemon.com",
  "clauderon.com",
];

function ok(message: string): DnsRecordResult {
  return { status: "ok", message };
}

function warning(message: string): DnsRecordResult {
  return { status: "warning", message };
}

function error(message: string): DnsRecordResult {
  return { status: "error", message };
}

async function checkSpf(domain: string): Promise<DnsRecordResult> {
  try {
    const records = await dns.resolveTxt(domain);
    const spfRecords = records
      .map((r) => r.join(""))
      .filter((r) => r.startsWith("v=spf1"));

    if (spfRecords.length === 0) {
      return error("No SPF record found");
    }
    if (spfRecords.length > 1) {
      return warning(
        `Multiple SPF records found: ${String(spfRecords.length)}`,
      );
    }

    const spf = spfRecords[0] ?? "";

    // Check for common issues
    if (!spf.includes("-all") && !spf.includes("~all")) {
      return warning("SPF record missing -all or ~all qualifier");
    }

    // Count DNS lookups (each include/a/mx/exists is a lookup, max 10)
    const lookupTerms = spf.match(/\b(?:include|a|mx|exists|redirect)[:=]/g);
    const lookupCount = lookupTerms?.length ?? 0;
    if (lookupCount > 10) {
      return error(
        `SPF exceeds 10-lookup limit: ${String(lookupCount)} lookups`,
      );
    }

    return ok(`SPF valid: ${spf}`);
  } catch (error_) {
    return error(`SPF lookup failed: ${String(error_)}`);
  }
}

async function checkDmarc(domain: string): Promise<DnsRecordResult> {
  try {
    const records = await dns.resolveTxt(`_dmarc.${domain}`);
    const dmarcRecords = records
      .map((r) => r.join(""))
      .filter((r) => r.startsWith("v=DMARC1"));

    if (dmarcRecords.length === 0) {
      return error("No DMARC record found");
    }

    const dmarc = dmarcRecords[0] ?? "";
    const policyMatch = /;\s*p=(\w+)/.exec(dmarc);
    const policy = policyMatch?.[1] ?? "none";

    if (policy === "none") {
      return warning("DMARC policy is none (monitoring only)");
    }

    return ok(`DMARC valid: policy=${policy}`);
  } catch (error_) {
    return error(`DMARC lookup failed: ${String(error_)}`);
  }
}

async function checkMx(
  domain: string,
  parked: boolean,
): Promise<DnsRecordResult> {
  try {
    const records = await dns.resolveMx(domain);

    if (parked) {
      // Parked domains should have null MX (0 .) or no MX
      if (records.length === 0) {
        return ok("No MX records (correct for parked domain)");
      }
      return warning(
        `Parked domain has ${String(records.length)} MX record(s)`,
      );
    }

    if (records.length === 0) {
      return error("No MX records found for email domain");
    }

    const mxList = records
      .toSorted((a, b) => a.priority - b.priority)
      .map((r) => `${String(r.priority)} ${r.exchange}`)
      .join(", ");
    return ok(`MX records: ${mxList}`);
  } catch {
    if (parked) {
      return ok("No MX records (correct for parked domain)");
    }
    return error("MX lookup failed");
  }
}

export type DnsAuditActivities = typeof dnsAuditActivities;

export const dnsAuditActivities = {
  async getDomains(): Promise<{
    emailDomains: string[];
    noEmailDomains: string[];
  }> {
    return await Promise.resolve({
      emailDomains: EMAIL_DOMAINS,
      noEmailDomains: NO_EMAIL_DOMAINS,
    });
  },

  async checkDomain(domain: string, parked: boolean): Promise<DnsCheckResult> {
    const [spf, dmarc, mx] = await Promise.all([
      checkSpf(domain),
      checkDmarc(domain),
      checkMx(domain, parked),
    ]);

    return { domain, parked, spf, dmarc, mx };
  },

  async logAuditResults(results: DnsCheckResult[]): Promise<void> {
    await Promise.resolve();
    for (const result of results) {
      const level =
        result.spf.status === "error" ||
        result.dmarc.status === "error" ||
        result.mx.status === "error"
          ? "error"
          : result.spf.status === "warning" ||
              result.dmarc.status === "warning" ||
              result.mx.status === "warning"
            ? "warning"
            : "info";

      const entry = {
        level,
        msg: `DNS audit: ${result.domain}`,
        domain: result.domain,
        parked: result.parked,
        spf: result.spf,
        dmarc: result.dmarc,
        mx: result.mx,
      };
      console.warn(JSON.stringify(entry));
    }
  },
};
