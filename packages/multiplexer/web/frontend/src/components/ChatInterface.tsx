import { useEffect, useRef, useState } from "react";
import { useConsole } from "../hooks/useConsole";
import { MessageParser } from "../lib/claudeParser";
import { MessageBubble } from "./MessageBubble";
import { X, Send, Terminal as TerminalIcon } from "lucide-react";

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
  const { client, isConnected } = useConsole(sessionId);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const parserRef = useRef(new MessageParser());

  const [messages, setMessages] = useState(() => parserRef.current.getMessages());

  // Handle incoming terminal data
  useEffect(() => {
    if (!client) {
      return;
    }

    const unsubscribe = client.onData((data) => {
      parserRef.current.addOutput(data);
      setMessages([...parserRef.current.getMessages()]);
    });

    const unsubscribeError = client.onError((err) => {
      setError(err.message);
    });

    return () => {
      unsubscribe();
      unsubscribeError();
    };
  }, [client]);

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-card rounded-lg max-w-6xl w-full h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold">{sessionName}</h2>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  isConnected ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span className="text-sm text-muted-foreground">
                {isConnected ? "Connected" : "Disconnected"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onSwitchToConsole && (
              <button
                onClick={onSwitchToConsole}
                className="p-2 hover:bg-secondary rounded-md transition-colors"
                title="Switch to raw console view"
              >
                <TerminalIcon className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-secondary rounded-md transition-colors"
              title="Close chat"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="p-4 bg-destructive/10 text-destructive border-b">
            Error: {error}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>No messages yet. Start a conversation!</p>
            </div>
          ) : (
            <div className="divide-y">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-4 border-t">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); }}
              placeholder="Type a message or command..."
              className="flex-1 px-4 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={!isConnected}
            />
            <button
              type="submit"
              disabled={!isConnected || !input.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              Send
            </button>
          </form>
          <p className="text-xs text-muted-foreground mt-2">
            This is a best-effort chat view. For full terminal control, switch to
            console view.
          </p>
        </div>
      </div>
    </div>
  );
}
