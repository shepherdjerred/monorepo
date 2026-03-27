import { CHUNK_SIZE, CHUNK_OVERLAP } from "./config.ts";

export type Chunk = {
  text: string;
  index: number;
};

/**
 * Split markdown text into chunks, respecting heading boundaries and code fences.
 * Uses a simple character-based approximation (4 chars ≈ 1 token).
 */
export function chunkMarkdown(
  text: string,
  maxChars: number = CHUNK_SIZE * 4,
  overlapChars: number = CHUNK_OVERLAP * 4,
): Chunk[] {
  if (text.trim().length === 0) return [];

  const sections = splitOnHeadings(text);
  const chunks: Chunk[] = [];
  let index = 0;

  for (const section of sections) {
    if (section.trim().length === 0) continue;

    if (section.length <= maxChars) {
      chunks.push({ text: section.trim(), index });
      index++;
    } else {
      const subChunks = splitLargeSection(section, maxChars, overlapChars);
      for (const sub of subChunks) {
        if (sub.trim().length === 0) continue;
        chunks.push({ text: sub.trim(), index });
        index++;
      }
    }
  }

  return chunks;
}

/**
 * Split on markdown headings, but not inside fenced code blocks.
 */
function splitOnHeadings(text: string): string[] {
  const sections: string[] = [];
  const lines = text.split("\n");
  let current: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    // Track fenced code blocks
    if (line.startsWith("```")) {
      inCodeFence = !inCodeFence;
      current.push(line);
      continue;
    }

    // Only split on headings outside code fences
    if (!inCodeFence && /^#{1,3}\s/.test(line) && current.length > 0) {
      sections.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    sections.push(current.join("\n"));
  }

  return sections;
}

/**
 * Split a large section into chunks by paragraphs.
 * If a single paragraph exceeds maxChars, split it on sentence boundaries.
 */
function splitLargeSection(
  text: string,
  maxChars: number,
  overlapChars: number,
): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    // If a single paragraph exceeds maxChars, split it further
    if (para.length > maxChars) {
      // Flush current buffer first
      if (current.trim().length > 0) {
        chunks.push(current);
        current = "";
      }
      // Split oversized paragraph on sentence boundaries
      const sentences = splitSentences(para);
      for (const sentence of sentences) {
        if (
          current.length + sentence.length + 1 > maxChars &&
          current.length > 0
        ) {
          chunks.push(current);
          const overlapStart = Math.max(0, current.length - overlapChars);
          current = current.slice(overlapStart) + " " + sentence;
        } else {
          current = current.length > 0 ? current + " " + sentence : sentence;
        }
      }
      continue;
    }

    if (current.length + para.length + 2 > maxChars && current.length > 0) {
      chunks.push(current);
      const overlapStart = Math.max(0, current.length - overlapChars);
      current = current.slice(overlapStart) + "\n\n" + para;
    } else {
      current = current.length > 0 ? current + "\n\n" + para : para;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * Split text on sentence boundaries (period/question/exclamation followed by space).
 */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
}
