import OpenAI from "openai";
import type { DependencyInfo, ReleaseNotes } from "./main-schemas.ts";

export async function summarizeWithLLM(
  changes: DependencyInfo[],
  releaseNotes: ReleaseNotes[],
): Promise<string> {
  const apiKey = Bun.env["OPENAI_API_KEY"];
  if ((apiKey == null || apiKey === "")) {
    console.warn("OPENAI_API_KEY not set, skipping LLM summarization");
    return "LLM summarization skipped - API key not configured";
  }

  const openai = new OpenAI({ apiKey });

  // Build the prompt
  const changesText = changes
    .map(
      (c) => `- ${c.name}: ${c.oldVersion} → ${c.newVersion} (${c.datasource})`,
    )
    .join("\n");

  const notesText = releaseNotes
    .map(
      (n) =>
        `## ${n.dependency} [${n.source}] (${n.version})\n${n.notes}\n${n.url != null && n.url !== "" ? `URL: ${n.url}` : ""}`,
    )
    .join("\n\n");

  // Note which dependencies we couldn't fetch notes for
  const fetchedDeps = new Set(
    releaseNotes.map((n) => n.dependency.replace(/ \((?:helm chart|app)\)$/, "")),
  );
  const missingNotes = changes
    .filter((c) => !fetchedDeps.has(c.name))
    .map((c) => c.name);
  const missingNotesText =
    missingNotes.length > 0
      ? `\n\nNote: Release notes could NOT be fetched for: ${missingNotes.join(", ")}. Be conservative with recommendations for these.`
      : "";

  const prompt = `You are a DevOps engineer reviewing weekly dependency updates for a homelab Kubernetes infrastructure.

Here are the dependencies that were updated this week:
${changesText}

Here are the available release notes:
${notesText}
${missingNotesText}

Please provide a concise summary that includes:
1. **Breaking Changes**: Any breaking changes that require immediate action
2. **Security Updates**: Any security-related fixes
3. **Notable New Features**: Features that might be useful for a homelab setup
4. **Recommended Actions**: Specific things to check or configure after these updates

IMPORTANT: Only include information that is EXPLICITLY mentioned in the release notes provided above.
Do NOT speculate or make assumptions about changes that are not documented.
For dependencies without release notes, simply note that no information is available.

Keep the summary actionable and focused on what matters for a self-hosted homelab environment.
Format the response in HTML for email.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.1",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 8000, // GPT-5.1 uses tokens for reasoning + output
    });

    const choice = completion.choices[0];
    return choice?.message.content ?? "Failed to generate summary";
  } catch (error) {
    console.error(`OpenAI API error: ${String(error)}`);
    return "Failed to generate LLM summary";
  }
}
