import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  Message,
  ContentBlock,
  ToolUseContent,
  ToolResultContent,
} from "../types";

interface ChatProps {
  messages: Message[];
  connected: boolean;
  isProcessing: boolean;
  error: string | null;
  onSendMessage: (content: string) => void;
  onInterrupt: () => void;
  onCommit: (message: string) => Promise<void>;
  onPush: () => Promise<void>;
  onCreatePR: (title: string, body: string) => Promise<void>;
}

export function Chat({
  messages,
  connected,
  isProcessing,
  error,
  onSendMessage,
  onInterrupt,
  onCommit,
  onPush,
  onCreatePR,
}: ChatProps) {
  const [input, setInput] = useState("");
  const [showActions, setShowActions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !connected || isProcessing) return;

    onSendMessage(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleCommit = async () => {
    const message = prompt("Enter commit message:");
    if (message) {
      try {
        await onCommit(message);
        alert("Changes committed successfully!");
      } catch (err) {
        alert(
          `Commit failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    }
  };

  const handlePush = async () => {
    try {
      await onPush();
      alert("Changes pushed successfully!");
    } catch (err) {
      alert(
        `Push failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  };

  const handleCreatePR = async () => {
    const title = prompt("Enter PR title:");
    if (!title) return;
    const body = prompt("Enter PR description:") || "";

    try {
      await onCreatePR(title, body);
      alert("Pull request created!");
    } catch (err) {
      alert(
        `PR creation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  };

  const renderContent = (content: ContentBlock[] | undefined) => {
    if (!content || !Array.isArray(content)) {
      return null;
    }
    return content.map((block, index) => {
      if (block.type === "text") {
        return (
          <div key={index} style={styles.textContent}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {block.text}
            </ReactMarkdown>
          </div>
        );
      }

      if (block.type === "tool_use") {
        const toolBlock = block as ToolUseContent;
        return (
          <div key={index} style={styles.toolUse}>
            <div style={styles.toolHeader}>
              <span style={styles.toolName}>{toolBlock.name}</span>
            </div>
            <pre style={styles.toolInput}>
              {JSON.stringify(toolBlock.input, null, 2)}
            </pre>
          </div>
        );
      }

      if (block.type === "tool_result") {
        const resultBlock = block as ToolResultContent;
        return (
          <div key={index} style={styles.toolResult}>
            <pre style={styles.toolOutput}>{resultBlock.content}</pre>
          </div>
        );
      }

      return null;
    });
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.status}>
          <span
            style={{
              ...styles.statusDot,
              backgroundColor: connected ? "#238636" : "#666",
            }}
          />
          {connected ? "Connected" : "Disconnected"}
        </div>
        <div style={styles.actions}>
          <button
            onClick={() => setShowActions(!showActions)}
            style={styles.actionsButton}
          >
            Git Actions
          </button>
          {showActions && (
            <div style={styles.actionsDropdown}>
              <button onClick={handleCommit} style={styles.actionItem}>
                Commit
              </button>
              <button onClick={handlePush} style={styles.actionItem}>
                Push
              </button>
              <button onClick={handleCreatePR} style={styles.actionItem}>
                Create PR
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {messages.length === 0 ? (
          <div style={styles.empty}>Start a conversation with Claude</div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              style={{
                ...styles.message,
                ...(message.role === "user"
                  ? styles.userMessage
                  : styles.assistantMessage),
              }}
            >
              <div style={styles.messageRole}>
                {message.role === "user" ? "You" : "Claude"}
              </div>
              {renderContent(message.content)}
            </div>
          ))
        )}
        {isProcessing && (
          <div style={styles.processing}>
            <span style={styles.spinner} />
            Claude is thinking...
          </div>
        )}
        {error && <div style={styles.error}>{error}</div>}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} style={styles.inputContainer}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={connected ? "Send a message..." : "Connecting..."}
          disabled={!connected}
          style={styles.input}
          rows={3}
        />
        <div style={styles.inputActions}>
          {isProcessing && (
            <button
              type="button"
              onClick={onInterrupt}
              style={styles.interruptButton}
            >
              Stop
            </button>
          )}
          <button
            type="submit"
            disabled={!connected || !input.trim() || isProcessing}
            style={styles.sendButton}
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "#1a1a2e",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    borderBottom: "1px solid #333",
    background: "#16161d",
  },
  status: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: "#888",
    fontSize: "13px",
  },
  statusDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
  },
  actions: {
    position: "relative",
  },
  actionsButton: {
    background: "#333",
    color: "#eee",
    border: "1px solid #444",
    borderRadius: "4px",
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: "12px",
  },
  actionsDropdown: {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: "4px",
    background: "#222",
    border: "1px solid #444",
    borderRadius: "4px",
    overflow: "hidden",
    zIndex: 10,
  },
  actionItem: {
    display: "block",
    width: "100%",
    padding: "8px 16px",
    background: "none",
    border: "none",
    color: "#eee",
    fontSize: "13px",
    textAlign: "left",
    cursor: "pointer",
  },
  messages: {
    flex: 1,
    overflow: "auto",
    padding: "16px",
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#666",
    fontSize: "14px",
  },
  message: {
    marginBottom: "16px",
    padding: "12px",
    borderRadius: "8px",
  },
  userMessage: {
    background: "#1e3a5f",
    marginLeft: "48px",
  },
  assistantMessage: {
    background: "#222",
    marginRight: "48px",
  },
  messageRole: {
    fontSize: "11px",
    fontWeight: 600,
    color: "#888",
    marginBottom: "8px",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  textContent: {
    fontSize: "14px",
    lineHeight: 1.6,
    color: "#eee",
  },
  toolUse: {
    margin: "8px 0",
    background: "#1a1a24",
    borderRadius: "6px",
    overflow: "hidden",
  },
  toolHeader: {
    padding: "8px 12px",
    background: "#252530",
    borderBottom: "1px solid #333",
  },
  toolName: {
    fontSize: "12px",
    color: "#58a6ff",
    fontFamily: "monospace",
  },
  toolInput: {
    margin: 0,
    padding: "12px",
    fontSize: "12px",
    color: "#aaa",
    overflow: "auto",
    maxHeight: "200px",
  },
  toolResult: {
    margin: "8px 0",
    background: "#1a1a24",
    borderRadius: "6px",
    borderLeft: "3px solid #238636",
  },
  toolOutput: {
    margin: 0,
    padding: "12px",
    fontSize: "12px",
    color: "#8b949e",
    overflow: "auto",
    maxHeight: "300px",
  },
  processing: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: "#888",
    fontSize: "13px",
    padding: "12px",
  },
  spinner: {
    width: "12px",
    height: "12px",
    border: "2px solid #444",
    borderTopColor: "#58a6ff",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  error: {
    padding: "12px",
    background: "#3d1d1d",
    borderRadius: "6px",
    color: "#f85149",
    fontSize: "13px",
  },
  inputContainer: {
    padding: "12px 16px",
    borderTop: "1px solid #333",
    background: "#16161d",
  },
  input: {
    width: "100%",
    background: "#222",
    border: "1px solid #444",
    borderRadius: "6px",
    padding: "12px",
    color: "#eee",
    fontSize: "14px",
    resize: "none",
    fontFamily: "inherit",
  },
  inputActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "8px",
  },
  sendButton: {
    background: "#238636",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    padding: "8px 16px",
    cursor: "pointer",
    fontSize: "13px",
  },
  interruptButton: {
    background: "#c93c37",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    padding: "8px 16px",
    cursor: "pointer",
    fontSize: "13px",
  },
};
