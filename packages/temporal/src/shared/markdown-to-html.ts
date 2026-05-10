import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

const STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #222; line-height: 1.45; max-width: 900px; margin: 0 auto; padding: 16px; }
  h1, h2, h3, h4 { line-height: 1.25; margin-top: 1.2em; margin-bottom: 0.4em; }
  h1 { font-size: 1.6em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
  h2 { font-size: 1.3em; border-bottom: 1px solid #eee; padding-bottom: 0.15em; }
  h3 { font-size: 1.1em; }
  table { border-collapse: collapse; margin: 0.6em 0 1em 0; font-size: 0.9em; font-family: "SF Mono", "Menlo", "Consolas", monospace; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; vertical-align: top; text-align: left; }
  th { background: #f4f4f4; font-weight: 600; }
  tr:nth-child(even) td { background: #fafafa; }
  code { font-family: "SF Mono", "Menlo", "Consolas", monospace; background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
  pre { background: #f4f4f4; padding: 8px 12px; border-radius: 4px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 0.6em 0; padding: 0.2em 1em; border-left: 4px solid #ccc; color: #555; }
  ul, ol { margin: 0.4em 0; padding-left: 1.6em; }
  li { margin: 0.15em 0; }
  hr { border: none; border-top: 1px solid #ddd; margin: 1.2em 0; }
  a { color: #0366d6; text-decoration: none; }
  a:hover { text-decoration: underline; }
`.trim();

// Markdown comes from `claude -p` over kubectl/log/PD output, so the source
// can carry attacker-influenced strings (pod names, log lines, third-party
// API responses). marked.parse() passes raw HTML through verbatim, which
// would round-trip a `<script>` or `<img onerror>` straight into the email
// body. Sanitize the rendered HTML against an allowlist that covers every
// element our markdown can legitimately produce — GFM tables, fenced code,
// headings, lists, blockquotes, links — and nothing else.
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "br",
    "hr",
    "strong",
    "em",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "a",
    "del",
    "ins",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    th: ["align"],
    td: ["align"],
  },
  allowedSchemes: ["http", "https", "mailto"],
};

/**
 * Convert audit markdown to email-safe HTML with an inlined <style> block.
 *
 * Uses GitHub-Flavored Markdown via `marked` (tables, fenced code, autolinks),
 * then sanitizes against a strict allowlist before embedding in the email.
 * No external CSS — every email client should render this without help.
 *
 * The renderer is deliberately permissive about emoji, status prefixes, and
 * trailing whitespace — the audit agent's markdown is human-style, not
 * machine-perfect.
 */
export function renderAuditMarkdownToHtml(markdown: string): string {
  const marked = new Marked({
    gfm: true,
    breaks: false,
    pedantic: false,
  });
  const body = sanitizeHtml(
    marked.parse(markdown, { async: false }),
    SANITIZE_OPTIONS,
  );
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
  ].join("\n");
}

/**
 * Parse the agent's TL;DR for the Red/Yellow/Green / open-PD counts so we can
 * build a useful email subject line. Returns `undefined` when the audit
 * doesn't follow the expected shape — the caller should fall back to a
 * generic subject in that case.
 */
export function extractAuditSubjectCounts(
  markdown: string,
): { red: number; yellow: number; green: number; openPd: number } | undefined {
  // Matrix line shape (from the runbook):
  //   Application Health Matrix: 0 Red / 8 Yellow / 52 Green
  const matrix = /(\d+)\s*Red\s*\/\s*(\d+)\s*Yellow\s*\/\s*(\d+)\s*Green/i.exec(
    markdown,
  );
  // PD line shape:
  //   Open PagerDuty incidents: 7
  const pd = /Open PagerDuty incidents?:\s*(\d+)/i.exec(markdown);
  if (matrix === null || pd === null) {
    return undefined;
  }
  return {
    red: Number(matrix[1]),
    yellow: Number(matrix[2]),
    green: Number(matrix[3]),
    openPd: Number(pd[1]),
  };
}

export function buildAuditEmailSubject(
  date: string,
  counts: ReturnType<typeof extractAuditSubjectCounts>,
): string {
  if (counts === undefined) {
    return `Homelab Audit ${date}`;
  }
  return `Homelab Audit ${date} — ${String(counts.red)} Red, ${String(counts.yellow)} Yellow, ${String(counts.green)} Green | ${String(counts.openPd)} open PD`;
}
