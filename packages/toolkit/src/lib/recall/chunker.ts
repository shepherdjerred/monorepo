import { CHUNK_SIZE, CHUNK_OVERLAP } from "./config.ts";

export type Chunk = {
  text: string;
  index: number;
};

/**
 * Split markdown text into chunks, respecting heading boundaries.
 * Uses a simple character-based approximation (4 chars ≈ 1 token).
 */
export function chunkMarkdown(
  text: string,
  maxChars: number = CHUNK_SIZE * 4,
  overlapChars: number = CHUNK_OVERLAP * 4,
): Chunk[] {
  if (text.trim().length === 0) return [];

  // Split on markdown headings (## or higher)
  const sections = splitOnHeadings(text);
  const chunks: Chunk[] = [];
  let index = 0;

  for (const section of sections) {
    if (section.trim().length === 0) continue;

    if (section.length <= maxChars) {
      chunks.push({ text: section.trim(), index });
      index++;
    } else {
      // Section too large — split by paragraphs, then by size
      const subChunks = splitLargeSection(section, maxChars, overlapChars);
      for (const sub of subChunks) {
        chunks.push({ text: sub.trim(), index });
        index++;
      }
    }
  }

  return chunks;
}

function splitOnHeadings(text: string): string[] {
  const sections: string[] = [];
  const lines = text.split("\n");
  let current: string[] = [];

  for (const line of lines) {
    // Split on ## headings (level 2+) but keep # level 1 with following content
    if (/^#{1,3}\s/.test(line) && current.length > 0) {
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

function splitLargeSection(
  text: string,
  maxChars: number,
  overlapChars: number,
): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current.length > 0) {
      chunks.push(current);
      // Keep overlap from end of previous chunk
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
