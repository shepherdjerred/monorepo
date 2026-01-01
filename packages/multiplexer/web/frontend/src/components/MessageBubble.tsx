import type { Message } from "../lib/claudeParser";
import { User, Bot, Terminal, FileText, Edit, Search } from "lucide-react";
import { formatRelativeTime } from "../lib/utils";

type MessageBubbleProps = {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  const icon = isUser ? (
    <User className="w-5 h-5" />
  ) : (
    <Bot className="w-5 h-5" />
  );

  const toolIcons: Record<string, React.ReactNode> = {
    Read: <FileText className="w-4 h-4" />,
    Write: <FileText className="w-4 h-4" />,
    Edit: <Edit className="w-4 h-4" />,
    Bash: <Terminal className="w-4 h-4" />,
    Grep: <Search className="w-4 h-4" />,
    Glob: <Search className="w-4 h-4" />,
  };

  return (
    <div
      className={`flex gap-4 p-4 border-b-2 ${
        isUser
          ? "bg-primary/5"
          : isSystem
            ? "bg-secondary/50"
            : "bg-card"
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
            {isUser ? "You" : isSystem ? "System" : "Claude Code"}
          </span>
          <span className="text-xs font-mono text-muted-foreground">
            {formatRelativeTime(message.timestamp.toISOString())}
          </span>
        </div>

        {/* Message text */}
        {message.content && (
          <div className="prose prose-sm max-w-none dark:prose-invert mb-3">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        )}

        {/* Tool uses with chunky borders */}
        {message.toolUses && message.toolUses.length > 0 && (
          <div className="space-y-3 mb-3">
            {message.toolUses.map((tool, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 p-3 bg-accent/5 border-2 border-accent text-sm"
              >
                <div className="flex-shrink-0 mt-0.5">
                  {toolIcons[tool.name] ?? <Terminal className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold font-mono">{tool.name}</div>
                  {tool.description && (
                    <div className="text-muted-foreground mt-1 font-mono text-xs break-all">
                      {tool.description}
                    </div>
                  )}
                  {tool.result && (
                    <div className="mt-2 p-2 bg-background border-2 text-xs font-mono overflow-x-auto">
                      {tool.result}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Code blocks with retro terminal style */}
        {message.codeBlocks && message.codeBlocks.length > 0 && (
          <div className="space-y-3">
            {message.codeBlocks.map((block, idx) => (
              <div key={idx} className="border-4 border-primary overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-primary text-primary-foreground">
                  <span className="font-mono text-xs font-bold uppercase">{block.language}</span>
                  {block.filePath && (
                    <span className="font-mono text-xs">{block.filePath}</span>
                  )}
                </div>
                <pre className="p-4 bg-[#0a0e14] overflow-x-auto">
                  <code className="text-sm font-mono text-[#e6e1dc]">{block.code}</code>
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
