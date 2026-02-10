import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

type CodeBlockProps = {
  code: string;
  language: string;
  filePath?: string | undefined;
};

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char] ?? char);
}

export function CodeBlock({ code, language, filePath }: CodeBlockProps) {
  const [html, setHtml] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function highlight() {
      try {
        const highlighted = await codeToHtml(code, {
          lang: language || "text",
          theme: "nord",
        });
        if (!cancelled) {
          setHtml(highlighted);
          setIsLoading(false);
        }
      } catch {
        // Fallback to plain text if language is not supported
        if (!cancelled) {
          setHtml(`<pre><code>${escapeHtml(code)}</code></pre>`);
          setIsLoading(false);
        }
      }
    }

    void highlight();

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return (
    <div className="border-4 border-primary overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-primary text-primary-foreground">
        <span className="font-mono text-xs font-bold uppercase">{language}</span>
        {filePath && <span className="font-mono text-xs">{filePath}</span>}
      </div>
      {isLoading ? (
        <div className="p-4 bg-[#0a0e14] text-[#e6e1dc] font-mono text-sm">
          Loading syntax highlighting...
        </div>
      ) : (
        <div
          className="overflow-x-auto [&>pre]:p-4 [&>pre]:m-0 [&>pre]:bg-[#0a0e14]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
