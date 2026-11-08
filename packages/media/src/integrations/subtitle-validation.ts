import { z } from "zod";
import rawTables from "./chinese-script-data.json" with { type: "json" };
import { subtitleDialogue } from "./subtitle-dialogue.ts";

const TablesSchema = z.object({
  source: z.string(),
  simplifiedOnly: z.string().min(1000),
  traditionalOnly: z.string().min(1000),
});
const tables = TablesSchema.parse(rawTables);
const simplified = new Set(tables.simplifiedOnly);
const traditional = new Set(tables.traditionalOnly);
const machineLabel =
  /\bAI\b|machine[- ]translated|machine translation|auto[- ]translated|机器翻译|機器翻譯|机翻|機翻|自动翻译|自動翻譯|AI翻译|AI翻譯/iu;

export function isMachineLabelled(text: string): boolean {
  return machineLabel.test(text);
}

/** Distinct script-exclusive characters provide evidence; shared Han characters provide none. */
export function chineseScriptEvidence(text: string): {
  simplifiedEvidence: number;
  traditionalEvidence: number;
} {
  const characters = new Set(text);
  return {
    simplifiedEvidence: [...characters].filter((character) =>
      simplified.has(character),
    ).length,
    traditionalEvidence: [...characters].filter((character) =>
      traditional.has(character),
    ).length,
  };
}

export type ValidatedSubtitle = {
  text: string;
  format: "srt" | "ass" | "ssa" | "vtt";
  simplifiedEvidence: number;
  traditionalEvidence: number;
};

type SubtitleEncoding = "utf8" | "utf-16le" | "utf-16be" | "gb18030";

function decodeSubtitle(
  bytes: Uint8Array,
  declaredEncoding?: SubtitleEncoding,
): string {
  let bom: SubtitleEncoding | undefined;
  if (bytes[0] === 255 && bytes[1] === 254) bom = "utf-16le";
  else if (bytes[0] === 254 && bytes[1] === 255) bom = "utf-16be";
  else if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191)
    bom = "utf8";
  if (
    bom !== undefined &&
    declaredEncoding !== undefined &&
    bom !== declaredEncoding
  )
    throw new Error("Subtitle encoding declaration conflicts with BOM");
  try {
    return new TextDecoder(bom ?? declaredEncoding ?? "utf8", { fatal: true })
      .decode(bytes)
      .replaceAll(/\r\n?/gu, "\n");
  } catch {
    throw new Error("Subtitle requires explicit encoding conversion");
  }
}

export function validateSubtitle(input: {
  bytes: Uint8Array;
  filename: string;
  requireSimplified: boolean;
  provenanceText: string;
  declaredEncoding?: SubtitleEncoding;
}): ValidatedSubtitle {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > 8 * 1024 * 1024)
    throw new Error("Subtitle exceeds content bounds");
  const format = z
    .enum(["srt", "ass", "ssa", "vtt"])
    .parse(input.filename.toLowerCase().split(".").at(-1));
  const text = decodeSubtitle(input.bytes, input.declaredEncoding);
  if (text.includes("\0") || /<!doctype|<html/iu.test(text))
    throw new Error("Subtitle contains invalid text");
  const dialogue = subtitleDialogue(text, format);
  if (isMachineLabelled(input.provenanceText) || isMachineLabelled(text))
    throw new Error("Subtitle is labelled as machine translated");
  const evidence = chineseScriptEvidence(dialogue);
  if (
    input.requireSimplified &&
    (evidence.traditionalEvidence > 0 || evidence.simplifiedEvidence < 5)
  )
    throw new Error("Subtitle lacks unambiguous Simplified Chinese evidence");
  return { text, format, ...evidence };
}
