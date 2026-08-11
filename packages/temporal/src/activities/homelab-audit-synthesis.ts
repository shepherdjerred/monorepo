import OpenAI from "openai";
import { traceOpenAi } from "@shepherdjerred/llm-observability";
import type { HomelabAuditCollection } from "./homelab-audit-collectors.ts";

function firstWords(value: string, maximum: number): string {
  return value.trim().split(/\s+/).slice(0, maximum).join(" ");
}

export async function synthesizeHomelabAuditEvidence(
  collection: HomelabAuditCollection,
): Promise<string | undefined> {
  const apiKey = Bun.env["OPENAI_API_KEY"];
  if (
    apiKey === undefined ||
    apiKey === "" ||
    collection.findings.length === 0
  ) {
    return undefined;
  }
  const params = {
    model: "gpt-5.6-sol",
    messages: [
      {
        role: "user" as const,
        content: [
          "Summarize this homelab collector result in at most 80 words. Use only supplied facts. No headings, boilerplate, recommendations, or status labels.",
          JSON.stringify({
            checks: collection.checks,
            findings: collection.findings,
            limitations: collection.limitations,
          }),
        ].join("\n"),
      },
    ],
    max_completion_tokens: 300,
  };
  try {
    const result = await traceOpenAi(
      {
        service: "temporal",
        callSite: "homelab-audit-synthesis",
        request: params,
      },
      async () => new OpenAI({ apiKey }).chat.completions.create(params),
    );
    const content = result.choices[0]?.message.content?.trim();
    return content === undefined || content === ""
      ? undefined
      : firstWords(content, 80);
  } catch (error) {
    console.warn(
      `Homelab synthesis unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}
