const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
  "&#x27;": "'",
  "&#x2F;": "/",
};

export function htmlToText(html: string): string {
  let text = html;
  // Replace <br> and block-level tags with newlines
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n");
  text = text.replace(/<(p|div|h[1-6])[^>]*>/gi, "\n");
  // Replace list items with bullet
  text = text.replace(/<li[^>]*>/gi, "\n- ");
  // Preserve code blocks
  text = text.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
    return "\n```\n" + decodeEntities(code) + "\n```\n";
  });
  // Inline code
  text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`");
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");
  // Decode HTML entities
  text = decodeEntities(text);
  // Normalize whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function decodeEntities(text: string): string {
  let result = text;
  for (const [entity, char] of Object.entries(ENTITIES)) {
    result = result.replaceAll(entity, char);
  }
  // Numeric entities
  result = result.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return result;
}

export function extractConstraints(html: string): string | null {
  // Constraints are typically after <strong>Constraints:</strong> in a <ul>
  const match = html.match(/<strong>Constraints:<\/strong>\s*<\/p>\s*<ul>([\s\S]*?)<\/ul>/i);
  if (!match) return null;
  return htmlToText(match[1]);
}
