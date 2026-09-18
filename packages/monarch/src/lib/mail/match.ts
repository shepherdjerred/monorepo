import { z } from "zod";
import {
  generateValidatedObject,
  StructuredOutputUsageError,
} from "@shepherdjerred/llm-runtime";
import type { TransactionCandidates } from "./candidates.ts";
import { extractTextBody } from "./parse.ts";
import { getRuntime, getModelId, getTracker } from "../classifier/llm.ts";
import type { MonarchCategory } from "../monarch/types.ts";
import { NOTE_PREFIX } from "../enrichment/notes.ts";

export const EMAIL_NOTE_PREFIX = `${NOTE_PREFIX}Email: `;

const BODY_EXCERPT_CAP = 4 * 1024;

// All fields required (nullable, never optional): OpenAI strict structured
// outputs reject properties missing from `required`.
export const EmailMatchSchema = z.object({
  matchedIndex: z.number().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  suggestedCategoryId: z.string().nullable(),
  note: z.string().nullable(),
  reason: z.string(),
});

export type EmailMatchResult = z.infer<typeof EmailMatchSchema>;

export function buildEmailMatchPrompt(
  item: TransactionCandidates,
  bodies: string[],
  categories: MonarchCategory[],
): string {
  const t = item.transaction;
  const categoryLines = categories
    .map((c) => `${c.id} = ${c.name} (${c.group.type})`)
    .join("\n");
  const candidateBlocks = item.candidates
    .map((c, i) => {
      const body = (bodies[i] ?? "").slice(0, BODY_EXCERPT_CAP);
      return `--- Candidate ${String(i)} ---\nFrom: ${c.entry.from}\nSubject: ${c.entry.subject}\nDate: ${c.entry.date}\nBody excerpt:\n${body}`;
    })
    .join("\n\n");

  return `Bank transaction:
  Date: ${t.date}
  Amount: ${String(t.amount)}
  Merchant: ${t.merchant.name}
  Statement text: ${t.plaidName}
  Current category: ${t.category.name} (id ${t.category.id})

Candidate emails that may document this transaction:

${candidateBlocks}

Available categories (id = name (group)):
${categoryLines}

Decide whether one candidate email documents THIS transaction (same purchase,
same amount or clearly the same order). If none do, matchedIndex must be null.
When matched:
- note: one short line naming what the money actually bought — the restaurant
  or shop the order came from, the items, the service, the subscription plan,
  the billing period. Anything the email names that the bank line does not
  belongs here; "DoorDash order from MOTO Pizza" is a note, "DoorDash order"
  is not. No marketing text. Use null only when the email genuinely carries
  nothing the merchant name already said, such as a bare charge alert with no
  order details.
- suggestedCategoryId: the best category id for this transaction given the
  email contents, or null if the current category is already correct.
Never suggest a category whose group differs from the current category's
group. Set confidence to how certain the email-transaction match is.`;
}

export async function judgeEmailMatch(
  item: TransactionCandidates,
  categories: MonarchCategory[],
): Promise<EmailMatchResult> {
  const bodies: string[] = [];
  for (const candidate of item.candidates) {
    const file = Bun.file(candidate.entry.path);
    // The live mail store can shift under the cached index
    bodies.push(
      (await file.exists()) ? extractTextBody(await file.text()) : "",
    );
  }
  const prompt = buildEmailMatchPrompt(item, bodies, categories);

  try {
    const finalized = await generateValidatedObject(getRuntime(), {
      model: getModelId(),
      schema: EmailMatchSchema,
      schemaName: "monarch_email_match",
      system:
        "You match bank transactions to the emails that document them and suggest better categorization. Be conservative: an amount coincidence without merchant affinity is not a match.",
      prompt,
      workload: "monarch.email.match",
      maxOutputTokens: 2048,
    });
    getTracker()?.record(
      finalized.usage.tokens.input,
      finalized.usage.tokens.output,
    );
    return finalized.object;
  } catch (error: unknown) {
    // Failed structured attempts are still billed
    if (error instanceof StructuredOutputUsageError) {
      getTracker()?.record(error.usage.tokens.input, error.usage.tokens.output);
    }
    throw error;
  }
}
