import path from "node:path";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";
import type { AgentDefinition } from "@shepherdjerred/sentinel/types/agent.ts";
import { type SearchResult, createIndexer } from "./indexer.ts";
import { readNote } from "./index.ts";

const log = logger.child({ module: "memory-context" });

const TOTAL_BUDGET = 4000;

function buildSnippets(
  results: SearchResult[],
  budgetRemaining: number,
): string[] {
  const snippets: string[] = [];
  let remaining = budgetRemaining;

  for (const result of results) {
    if (remaining <= 0) break;

    const headerPrefix = `### ${result.title}\n`;
    const bodyBudget = remaining - headerPrefix.length;
    if (bodyBudget <= 0) break;

    const snippet =
      result.body.length > bodyBudget
        ? result.body.slice(0, bodyBudget) + "..."
        : result.body;
    const decorated = `${headerPrefix}${snippet}`;
    remaining -= decorated.length;
    snippets.push(decorated);
  }

  return snippets;
}

function extractKeywords(text: string): string {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "shall",
    "should",
    "may",
    "might",
    "must",
    "can",
    "could",
    "of",
    "in",
    "to",
    "for",
    "with",
    "on",
    "at",
    "from",
    "by",
    "about",
    "as",
    "into",
    "through",
    "and",
    "but",
    "or",
    "not",
    "no",
    "it",
    "its",
    "this",
    "that",
    "these",
    "those",
    "i",
    "you",
    "he",
    "she",
    "we",
    "they",
    "me",
    "him",
    "her",
    "us",
    "them",
    "my",
    "your",
    "his",
    "our",
    "their",
    "what",
    "which",
    "who",
    "when",
    "where",
    "why",
    "how",
    "all",
    "each",
    "every",
    "both",
    "few",
    "more",
    "most",
    "other",
    "some",
    "any",
    "if",
    "then",
    "so",
    "just",
    "also",
  ]);

  const seen = new Set<string>();
  return text
    .toLowerCase()
    .replaceAll(/[^\s\w-]/g, " ")
    .split(/\s+/)
    .filter((w) => {
      if (w.length <= 2 || stopWords.has(w) || seen.has(w)) return false;
      seen.add(w);
      return true;
    })
    .slice(0, 10)
    .join(" ");
}

export async function buildMemoryContext(
  agentDef: AgentDefinition,
  jobPrompt: string,
  memoryDir = "data/memory",
): Promise<string> {
  const sections: string[] = [];

  // Read private MEMORY.md
  const privatePath = path.join(
    memoryDir,
    "agents",
    agentDef.name,
    "MEMORY.md",
  );
  try {
    const privateNote = await readNote(privatePath);
    if (privateNote.body.length > 0) {
      sections.push(`## Agent Memory\n${privateNote.body}`);
    }
  } catch {
    log.debug({ agent: agentDef.name }, "no private MEMORY.md found");
  }

  // Search FTS5 index for relevant knowledge
  const keywords = extractKeywords(jobPrompt);
  if (keywords.length > 0) {
    const indexer = await createIndexer(memoryDir);
    try {
      await indexer.indexAll(path.join(memoryDir, "shared"));
      const results = indexer.search(keywords, 5);

      if (results.length > 0) {
        const sectionHeader = "## Relevant Knowledge\n";
        const budgetRemaining =
          TOTAL_BUDGET -
          sections.reduce((sum, s) => sum + s.length, 0) -
          sectionHeader.length;
        const snippets = buildSnippets(results, budgetRemaining);

        if (snippets.length > 0) {
          sections.push(`## Relevant Knowledge\n${snippets.join("\n\n")}`);
        }
      }
    } catch (error) {
      log.warn({ error }, "failed to search memory index");
    } finally {
      indexer.close();
    }
  }

  return sections.join("\n\n");
}
