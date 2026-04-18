import { proxyActivities } from "@temporalio/workflow";
import type { DnsAuditActivities } from "#activities/dns-audit.ts";
import type { DnsCheckResult } from "#shared/types.ts";

const { getDomains, checkDomain, logAuditResults } =
  proxyActivities<DnsAuditActivities>({
    startToCloseTimeout: "1 minute",
  });

export async function runDnsAudit(): Promise<void> {
  const { emailDomains, noEmailDomains } = await getDomains();

  const results: DnsCheckResult[] = [];

  // Check email domains
  for (const domain of emailDomains) {
    const result = await checkDomain(domain, false);
    results.push(result);
  }

  // Check parked (no-email) domains
  for (const domain of noEmailDomains) {
    const result = await checkDomain(domain, true);
    results.push(result);
  }

  await logAuditResults(results);
}
