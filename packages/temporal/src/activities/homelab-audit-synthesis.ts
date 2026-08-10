import type { HomelabAuditCollection } from "./homelab-audit-collectors.ts";
import { generateBoundedSynthesis } from "./openrouter-runtime.ts";

export async function synthesizeHomelabAuditEvidence(
  collection: HomelabAuditCollection,
): Promise<string | undefined> {
  if (collection.findings.length === 0) {
    return undefined;
  }
  return await generateBoundedSynthesis({
    callSite: "homelab-audit-synthesis",
    workload: "homelab-audit-synthesis",
    maxWords: 80,
    prompt: [
      "Summarize this homelab collector result in at most 80 words. Use only supplied facts. No headings, boilerplate, recommendations, or status labels.",
      JSON.stringify({
        checks: collection.checks,
        findings: collection.findings,
        limitations: collection.limitations,
      }),
    ].join("\n"),
  });
}
