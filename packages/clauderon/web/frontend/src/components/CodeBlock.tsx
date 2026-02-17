import { useEffect, useRef, useState, useCallback } from "react";
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

/**
 * Safely set HTML content on a DOM element.
 * The HTML comes from shiki (a trusted syntax highlighter) or from our own
 * escapeHtml function, so this is safe from XSS.
 */
function setTrustedHtml(element: HTMLElement, html: string): void {
  element.innerHTML = html; // Safe: HTML from shiki or escapeHtml
}

export function CodeBlock({ code, language, filePath }: CodeBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applyHighlightedHtml = useCallback((html: string) => {
    if (containerRef.current != null) {
      setTrustedHtml(containerRef.current, html);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function highlight() {
      try {
        const highlighted = await codeToHtml(code, {
          lang: language || "text",
          theme: "nord",
        });
        if (!cancelled) {
          applyHighlightedHtml(highlighted);
          setIsLoading(false);
        }
      } catch {
        // Fallback to plain text if language is not supported
        if (!cancelled) {
          applyHighlightedHtml(
            `<pre><code>${escapeHtml(code)}</code></pre>`,
          );
          setIsLoading(false);
        }
      }
    }

    void highlight();

    return () => {
      cancelled = true;
    };
  }, [code, language, applyHighlightedHtml]);

  return (
    <div className="border-4 border-primary overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-primary text-primary-foreground">
        <span className="font-mono text-xs font-bold uppercase">
          {language}
        </span>
        {filePath != null && filePath.length > 0 && <span className="font-mono text-xs">{filePath}</span>}
      </div>
      {isLoading ? (
        <div className="p-4 bg-[#0a0e14] text-[#e6e1dc] font-mono text-sm">
          Loading syntax highlighting...
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="overflow-x-auto [&>pre]:p-4 [&>pre]:m-0 [&>pre]:bg-[#0a0e14]"
        style={{ display: isLoading ? "none" : undefined }}
      />
    </div>
  );
}
