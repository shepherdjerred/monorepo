import { useEffect, useRef, useState } from "react";
import { useConsole } from "../hooks/useConsole";
import { useSessionHistory } from "../hooks/useSessionHistory";
import { MessageBubble } from "./MessageBubble";
import { Send, Terminal as TerminalIcon } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ChatInterfaceProps = {
  sessionId: string;
  sessionName: string;
  onClose: () => void;
  onSwitchToConsole?: () => void;
}

export function ChatInterface({
  sessionId,
  sessionName,
  onClose,
  onSwitchToConsole,
}: ChatInterfaceProps) {
  // Use session history hook for reading messages
  const { messages, isLoading, error, fileExists } = useSessionHistory(sessionId);

  // Still need console client for sending input
  const { client, isConnected } = useConsole(sessionId);

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !client || !isConnected) {
      return;
    }

    // Send input to console
    client.write(input + "\n");
    setInput("");
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) { onClose(); } }}>
      <DialogContent className="max-w-6xl h-[80vh] border-4 border-primary flex flex-col p-0">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b-4 border-primary">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold font-mono uppercase">{sessionName}</h2>
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 border-2 border-foreground ${
                  isConnected ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span className="text-sm font-mono">
                {isConnected ? "Connected" : "Disconnected"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onSwitchToConsole && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onSwitchToConsole}
                aria-label="Switch to raw console view"
              >
                <TerminalIcon className="w-5 h-5" />
              </Button>
            )}
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="p-4 bg-destructive/10 text-destructive border-b-2 border-destructive">
            <strong className="font-mono">Error:</strong> {error}
          </div>
        )}

        {/* Loading state */}
        {isLoading && messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="font-semibold">Loading conversation history...</p>
          </div>
        )}

        {/* Messages */}
        {!isLoading && (
          <div className="flex-1 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <p className="font-semibold">No messages yet. Start a conversation!</p>
              </div>
            ) : (
              <div>
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t-4 border-primary">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <Input
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); }}
              placeholder="Type a message or command..."
              className="flex-1 border-2 font-mono"
              disabled={!isConnected}
            />
            <Button
              type="submit"
              variant="brutalist"
              disabled={!isConnected || !input.trim()}
            >
              <Send className="w-4 h-4 mr-2" />
              Send
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-2 font-mono">
            Reading from Claude Code session history. For full terminal control, switch to console view.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
