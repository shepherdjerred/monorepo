import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod/v4";
import { traceOpenAi } from "@shepherdjerred/llm-observability";
import {
  RelationshipDirectionSchema,
  RelationshipKindSchema,
  StyleCardSchema,
  type RelationshipEvent,
  type StyleCard,
} from "@shepherdjerred/glitter-context/schema";
import type { CurrentMessage } from "#shared/glitter-corpus.ts";
import type { StyleRefreshCandidate } from "./glitter-context-refresh-selection.ts";

const MODEL = "gpt-5.6-sol";

const RelationshipProposalSchema = z.strictObject({
  sourceId: z.string(),
  targetId: z.string(),
  kind: RelationshipKindSchema,
  label: z.string(),
  direction: RelationshipDirectionSchema,
  effectiveAt: z.iso.date().nullable(),
  evidenceMessageIds: z.array(z.string().regex(/^\d+$/u)).min(2).max(8),
  confidence: z.number().min(0.9).max(1),
  rationale: z.string().min(1).max(500),
});

const RelationshipProposalsSchema = z.strictObject({
  proposals: z.array(RelationshipProposalSchema).max(20),
});

export type RelationshipProposal = z.infer<typeof RelationshipProposalSchema>;

function requireOpenAiApiKey(): string {
  const value = Bun.env["OPENAI_API_KEY"];
  if (value === undefined || value === "") {
    throw new Error("OPENAI_API_KEY is required for Glitter context refresh");
  }
  return value;
}

function client(): OpenAI {
  return new OpenAI({ apiKey: requireOpenAiApiKey() });
}

function messageEvidence(message: CurrentMessage): {
  messageId: string;
  timestamp: string;
  content: string;
} {
  return {
    messageId: message.messageId,
    timestamp: message.timestamp,
    content: message.content,
  };
}

export async function generateStyleCard(input: {
  candidate: StyleRefreshCandidate;
  existingCard: StyleCard;
}): Promise<StyleCard> {
  const messages = input.candidate.safeMessages.map((message) =>
    messageEvidence(message),
  );
  const prompt = [
    "Update this Discord style card using only the supplied messages.",
    "Preserve useful prior observations when the new evidence does not contradict them.",
    "Every sample_messages entry MUST be an exact, byte-for-byte content value",
    "from suppliedMessages. Choose at most 10 safe, representative samples.",
    "Do not infer sensitive traits, diagnoses, identity, or private facts.",
    "Do not include Discord IDs or message IDs in prose fields.",
    "",
    JSON.stringify({
      person: {
        id: input.candidate.person.id,
        displayName: input.candidate.person.displayName,
      },
      existingCard: input.existingCard,
      suppliedMessages: messages,
    }),
  ].join("\n");
  const params = {
    model: MODEL,
    messages: [
      {
        role: "system" as const,
        content:
          "You create evidence-grounded writing-style cards for human review.",
      },
      { role: "user" as const, content: prompt },
    ],
    max_completion_tokens: 10_000,
    response_format: zodResponseFormat(StyleCardSchema, "style_card"),
  };
  const completion = await traceOpenAi(
    {
      service: "temporal",
      callSite: "glitter-context-style-card",
      request: params,
    },
    async () => client().chat.completions.parse(params),
  );
  const parsed = completion.choices[0]?.message.parsed;
  if (parsed === null || parsed === undefined) {
    throw new Error(
      `GPT-5.6 Sol did not return a parsed style card for ${input.candidate.person.id}`,
    );
  }
  const safeContent = new Set(
    input.candidate.safeMessages.map((message) => message.content),
  );
  if (
    parsed.sample_messages.length > 10 ||
    parsed.sample_messages.some((sample) => !safeContent.has(sample))
  ) {
    throw new Error(
      `GPT-5.6 Sol returned an unsafe or non-verbatim sample for ${input.candidate.person.id}`,
    );
  }
  const first = input.candidate.messages[0];
  const last = input.candidate.messages.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error(
      `style refresh candidate ${input.candidate.person.id} has no messages`,
    );
  }
  return StyleCardSchema.parse({
    ...parsed,
    author: input.candidate.person.displayName,
    coverage: {
      messages: input.candidate.totalMessageCount,
      date_range: `${first.timestamp} through ${last.timestamp}`,
      notes:
        "Generated from the checksum-verified Discord corpus; human review required.",
    },
  });
}

export async function proposeRelationships(input: {
  people: readonly { id: string; displayName: string }[];
  currentRelationships: readonly RelationshipEvent[];
  evidence: readonly {
    personId: string;
    message: CurrentMessage;
  }[];
}): Promise<RelationshipProposal[]> {
  if (input.evidence.length === 0) {
    return [];
  }
  const prompt = [
    "Propose relationship updates only when the supplied Discord messages",
    "contain explicit, high-confidence evidence. Return no proposal when",
    "evidence is ambiguous, joking, hearsay, or merely stylistic.",
    "Each proposal needs 2-8 supplied message IDs. IDs must be copied exactly.",
    "Do not repeat a relationship that is already current.",
    "These proposals will be committed only to a human-reviewed PR.",
    "",
    JSON.stringify({
      people: input.people,
      currentRelationships: input.currentRelationships,
      evidence: input.evidence.map((entry) => ({
        personId: entry.personId,
        ...messageEvidence(entry.message),
      })),
    }),
  ].join("\n");
  const params = {
    model: MODEL,
    messages: [
      {
        role: "system" as const,
        content:
          "You identify explicit relationship changes conservatively and cite corpus evidence.",
      },
      { role: "user" as const, content: prompt },
    ],
    max_completion_tokens: 6000,
    response_format: zodResponseFormat(
      RelationshipProposalsSchema,
      "relationship_proposals",
    ),
  };
  const completion = await traceOpenAi(
    {
      service: "temporal",
      callSite: "glitter-context-relationships",
      request: params,
    },
    async () => client().chat.completions.parse(params),
  );
  const parsed = completion.choices[0]?.message.parsed;
  if (parsed === null || parsed === undefined) {
    throw new Error("GPT-5.6 Sol did not return parsed relationship proposals");
  }
  return parsed.proposals;
}
