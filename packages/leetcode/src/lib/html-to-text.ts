const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
  "&#x27;": "'",
  "&#x2F;": "/",
  "&ldquo;": '"',
  "&rdquo;": '"',
  "&rsquo;": "'",
  "&minus;": "-",
  "&rarr;": "->",
  "&times;": "x",
};

export function htmlToText(html: string): string {
  let text = html;
  // Replace <br> and block-level tags with newlines
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n");
  text = text.replace(/<(p|div|h[1-6])[^>]*>/gi, "\n");
  // Replace list items with bullet
  text = text.replace(/<li[^>]*>/gi, "\n- ");
  // Superscript/subscript
  text = text.replace(/<sup>(.*?)<\/sup>/gi, "^$1");
  text = text.replace(/<sub>(.*?)<\/sub>/gi, "_$1");
  // Preserve code blocks — handles both <pre><code>...</code></pre> and <pre>...</pre>
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => {
    // Strip inner <code> tags if present
    const clean = code.replace(/<\/?code[^>]*>/gi, "");
    return "\n```\n" + decodeEntities(clean) + "\n```\n";
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
  result = result.replace(/&#(\d+);/g, (_, num) =>
    String.fromCharCode(Number(num)),
  );
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  return result;
}

export function extractConstraints(html: string): string | null {
  const match = html.match(
    /<strong>Constraints:<\/strong>\s*<\/p>\s*<ul>([\s\S]*?)<\/ul>/i,
  );
  const captured = match?.[1];
  if (!captured) return null;
  return htmlToText(captured);
}
