import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { z } from "zod";

// Shared PDF text extraction. Statement-style documents need two different
// views of the same page: a flat blob for `Label: value` headers, and
// layout-aware lines for tables. Both are produced in one pdfjs pass.
//
// Kept outside the vendor directories (like src/lib/mail/) so every document
// source can use it — the architecture isolation group forbids vendors from
// importing each other.

export type PdfCell = {
  x: number;
  // Rendered width, so a right-aligned column can be identified by where its
  // values end rather than where they happen to start.
  width: number;
  str: string;
};

export type PdfLine = {
  page: number;
  y: number;
  text: string;
  // Cells keep their x so a caller can tell one column from another. A table
  // that leaves a cell empty prints nothing for it, so position in the line is
  // not the same as position in the table — only x identifies a column.
  cells: PdfCell[];
};

export type PdfPage = {
  page: number;
  blob: string;
  lines: PdfLine[];
};

export type ExtractOptions = {
  // Column clipping, for pages whose tables sit side by side and would
  // otherwise merge into one nonsense line.
  minX?: number;
  maxX?: number;
  // Items within this many units of each other vertically are one line.
  lineTolerance?: number;
};

// pdfjs hands back a union of text items and marked-content markers; only the
// former carry text and a position.
const TextItemSchema = z.object({
  str: z.string(),
  width: z.number(),
  transform: z.array(z.number()),
});

const DEFAULT_LINE_TOLERANCE = 3;

export function groupItemsIntoLines(
  items: { x: number; y: number; width: number; str: string }[],
  page: number,
  tolerance = DEFAULT_LINE_TOLERANCE,
): PdfLine[] {
  const rows: { y: number; items: PdfCell[] }[] = [];
  for (const item of items) {
    const cell = { x: item.x, width: item.width, str: item.str };
    const row = rows.find((r) => Math.abs(r.y - item.y) <= tolerance);
    if (row) {
      row.items.push(cell);
    } else {
      rows.push({ y: item.y, items: [cell] });
    }
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => lineFromCells(page, row.y, row.items))
    .filter((line) => line.text !== "");
}

function lineFromCells(page: number, y: number, cells: PdfCell[]): PdfLine {
  const ordered = [...cells].sort((a, b) => a.x - b.x);
  return {
    page,
    y,
    text: ordered
      .map((c) => c.str)
      .join(" ")
      .replaceAll(/\s+/g, " ")
      .trim(),
    cells: ordered,
  };
}

// A view of the same lines narrowed to one column band, for pages whose tables
// sit side by side and would otherwise read as one nonsense line.
export function clipLines(
  lines: PdfLine[],
  minX: number,
  maxX: number,
): PdfLine[] {
  return lines
    .map((line) =>
      lineFromCells(
        line.page,
        line.y,
        line.cells.filter((c) => c.x >= minX && c.x < maxX),
      ),
    )
    .filter((line) => line.text !== "");
}

export async function readPdfPages(
  filePath: string,
  options: ExtractOptions = {},
): Promise<PdfPage[]> {
  const data = new Uint8Array(await Bun.file(filePath).arrayBuffer());
  const doc = await getDocument({ data }).promise;
  const pages: PdfPage[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const pdfPage = await doc.getPage(pageNumber);
    const content = await pdfPage.getTextContent();
    const items: { x: number; y: number; width: number; str: string }[] = [];
    for (const raw of content.items) {
      const parsed = TextItemSchema.safeParse(raw);
      if (!parsed.success || parsed.data.str.trim() === "") continue;
      const x = parsed.data.transform[4] ?? 0;
      const y = parsed.data.transform[5] ?? 0;
      if (options.minX !== undefined && x < options.minX) continue;
      if (options.maxX !== undefined && x >= options.maxX) continue;
      items.push({ x, y, width: parsed.data.width, str: parsed.data.str });
    }
    const lines = groupItemsIntoLines(items, pageNumber, options.lineTolerance);
    pages.push({
      page: pageNumber,
      blob: lines.map((l) => l.text).join("\n"),
      lines,
    });
  }
  return pages;
}
