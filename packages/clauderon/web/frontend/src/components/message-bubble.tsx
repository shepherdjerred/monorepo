import type { Message } from "@shepherdjerred/clauderon/web/frontend/src/lib/claudeParser";
import { User, Bot, Terminal, FileText, Edit, Search } from "lucide-react";
import { formatRelativeTime } from "@shepherdjerred/clauderon/web/frontend/src/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock.tsx";
import { PlanView, isPlan } from "./PlanView.tsx";
import { QuestionView, isQuestion } from "./QuestionView.tsx";

type MessageBubbleProps = {
  message: Message;
};

function hasDisplayableContent(message: Message): boolean {
  if (message.content.trim()) { return true; }
  if (message.toolUses != null && message.toolUses.length > 0) { return true; }
  if (message.codeBlocks != null && message.codeBlocks.length > 0) { return true; }
  return false;
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  Read: <FileText className="w-4 h-4" />,
  Write: <FileText className="w-4 h-4" />,
  Edit: <Edit className="w-4 h-4" />,
  Bash: <Terminal className="w-4 h-4" />,
  Grep: <Search className="w-4 h-4" />,
  Glob: <Search className="w-4 h-4" />,
};

export function MessageBubble({ message }: MessageBubbleProps) {
  if (!hasDisplayableContent(message)) {
    return null;
  }

  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  // Render question with special styling
  if (isQuestion(message) && !isUser) {
    return (
      <div className="p-4 border-b-2">
        <QuestionView message={message} />
      </div>
    );
  }

  // Render plan with special styling
  if (isPlan(message) && !isUser) {
    return (
      <div className="p-4 border-b-2">
        <PlanView message={message} />
      </div>
    );
  }

  const icon = isUser ? (
    <User className="w-5 h-5" />
  ) : (
    <Bot className="w-5 h-5" />
  );

  return (
    <div
      className={`flex gap-4 p-4 border-b-2 ${
        isUser ? "bg-primary/5" : (isSystem ? "bg-secondary/50" : "bg-card")
      }`}
    >
      {/* Square Avatar (brutalist) */}
      <div
        className={`flex-shrink-0 w-10 h-10 border-2 border-foreground flex items-center justify-center ${
          isUser ? "bg-primary text-primary-foreground" : "bg-secondary"
        }`}
      >
        {icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <span className="font-bold font-mono uppercase text-sm tracking-wide">
            {isUser ? "You" : (isSystem ? "System" : "Claude Code")}
          </span>
          <span className="text-xs font-mono text-muted-foreground">
            {formatRelativeTime(message.timestamp.toISOString())}
          </span>
        </div>

        {/* Message text */}
        {message.content && (
          <div className="prose prose-sm max-w-none dark:prose-invert mb-3">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* Tool uses with chunky borders */}
        {message.toolUses != null && message.toolUses.length > 0 && (
          <div className="space-y-3 mb-3">
            {message.toolUses.map((tool, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 p-3 bg-accent/5 border-2 border-accent text-sm"
              >
                <div className="flex-shrink-0 mt-0.5">
                  {TOOL_ICONS[tool.name] ?? <Terminal className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold font-mono">{tool.name}</div>
                  {tool.description != null && tool.description.length > 0 && (
                    <div className="text-muted-foreground mt-1 font-mono text-xs break-all">
                      {tool.description}
                    </div>
                  )}
                  {tool.result != null && tool.result.length > 0 && (
                    <div className="mt-2 p-2 bg-background border-2 text-xs font-mono overflow-x-auto">
                      {tool.result}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Code blocks with syntax highlighting */}
        {message.codeBlocks != null && message.codeBlocks.length > 0 && (
          <div className="space-y-3">
            {message.codeBlocks.map((block, idx) => (
              <CodeBlock
                key={idx}
                code={block.code}
                language={block.language}
                filePath={block.filePath}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
