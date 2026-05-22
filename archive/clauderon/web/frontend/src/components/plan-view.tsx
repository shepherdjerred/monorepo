import type { Message } from "@/lib/claude-parser.ts";
import { FileText, CheckCircle2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type PlanViewProps = {
  message: Message;
};

export function PlanView({ message }: PlanViewProps) {
  return (
    <div className="border-4 border-primary bg-primary/5 p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b-2 border-primary/30">
        <div className="w-8 h-8 border-2 border-primary bg-primary text-primary-foreground flex items-center justify-center">
          <FileText className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold font-mono uppercase text-lg tracking-wide">
            Implementation Plan
          </h3>
          <p className="text-xs font-mono text-muted-foreground">
            Review and approve before implementation
          </p>
        </div>
      </div>

      {/* Plan content */}
      <div className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Style headings with brutalist borders
            h1: ({ children, ...props }) => (
              <h1 className="border-l-4 border-primary pl-3 mb-4" {...props}>
                {children}
              </h1>
            ),
            h2: ({ children, ...props }) => (
              <h2 className="border-l-4 border-primary/70 pl-3 mb-3" {...props}>
                {children}
              </h2>
            ),
            h3: ({ children, ...props }) => (
              <h3 className="border-l-2 border-primary/50 pl-2 mb-2" {...props}>
                {children}
              </h3>
            ),
            // Style checkboxes
            li: ({ children, ...props }) => {
              const childText =
                typeof children === "string"
                  ? children
                  : Array.isArray(children)
                    ? children.join("")
                    : "";
              if (childText.includes("[ ]") || childText.includes("[x]")) {
                const isChecked = childText.includes("[x]");
                return (
                  <li className="flex items-start gap-2" {...props}>
                    <CheckCircle2
                      className={`w-4 h-4 mt-1 flex-shrink-0 ${
                        isChecked ? "text-green-600" : "text-muted-foreground"
                      }`}
                    />
                    <span>{childText.replace(/\[(?:x| )\]\s*/, "")}</span>
                  </li>
                );
              }
              return <li {...props}>{children}</li>;
            },
          }}
        >
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

/**
 * Check if a message is a plan
 */
export function isPlan(message: Message): boolean {
  // Check for ExitPlanMode tool use
  if (message.toolUses?.some((tool) => tool.name === "ExitPlanMode") === true) {
    return true;
  }

  // Check for plan-like content
  const content = message.content.toLowerCase();
  return (
    content.includes("## implementation plan") ||
    content.includes("# implementation plan") ||
    (content.includes("## plan") && content.includes("implementation"))
  );
}
