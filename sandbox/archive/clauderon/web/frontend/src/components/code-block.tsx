import { useRef, useState } from "react";

type CodeBlockProps = {
  code: string;
  language: string;
  filePath?: string | undefined;
};

export function CodeBlock({ language, filePath }: CodeBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading] = useState(true);
  return (
    <div className="border-4 border-primary overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-primary text-primary-foreground">
        <span className="font-mono text-xs font-bold uppercase">
          {language}
        </span>
        {filePath != null && filePath.length > 0 && (
          <span className="font-mono text-xs">{filePath}</span>
        )}
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
