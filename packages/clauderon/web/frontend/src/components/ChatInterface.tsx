import { useEffect, useRef, useState } from "react";
import { useConsole } from "../hooks/useConsole";
import { useSessionHistory } from "../hooks/useSessionHistory";
import { MessageBubble } from "./MessageBubble";
import { Send, Terminal as TerminalIcon, X, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSessionContext } from "../contexts/SessionContext";

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
  const { messages, isLoading, error } = useSessionHistory(sessionId);

  // Still need console client for sending input
  const { client, isConnected } = useConsole(sessionId);

  const { client: apiClient } = useSessionContext();

  const [input, setInput] = useState("");
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !client || !isConnected) {
      return;
    }

    // Upload attached images first if any
    if (attachedImages.length > 0) {
      for (const file of attachedImages) {
        try {
          await apiClient.uploadImage(sessionId, file);
        } catch (error) {
          console.error("Failed to upload image:", error);
          // Continue even if upload fails
        }
      }
      setAttachedImages([]);
    }

    // Send input to console
    client.write(input + "\n");
    setInput("");
  };

  return (
    <>
      <div className="fixed inset-0 z-40" style={{
        backgroundColor: 'hsl(220, 90%, 8%)',
        opacity: 0.85
      }} />
      <div className="fixed inset-0 flex items-center justify-center p-8 z-50">
        <div className="max-w-5xl w-full h-[85vh] flex flex-col border-4 border-primary" style={{
          backgroundColor: 'hsl(220, 15%, 95%)',
          boxShadow: '12px 12px 0 hsl(220, 85%, 25%), 24px 24px 0 hsl(220, 90%, 10%)'
        }}>
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b-4 border-primary" style={{ backgroundColor: 'hsl(220, 85%, 25%)' }}>
            <div className="flex items-center gap-4">
              <h2 className="text-2xl font-bold font-mono uppercase tracking-wider text-white">
                {sessionName}
              </h2>
              <div className="flex items-center gap-2 px-3 py-1 border-2 border-white bg-white/10">
                <div
                  className={`w-3 h-3 border-2 border-white ${
                    isConnected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
                  }`}
                />
                <span className="text-sm font-mono font-bold uppercase text-white">
                  {isConnected ? "Online" : "Offline"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onSwitchToConsole && (
                <button
                  onClick={onSwitchToConsole}
                  className="cursor-pointer p-2 border-2 border-white bg-white/10 hover:bg-blue-600 hover:text-white transition-all duration-200 font-bold text-white"
                  title="Switch to console view"
                  aria-label="Switch to console view"
                >
                  <TerminalIcon className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={onClose}
                className="cursor-pointer p-2 border-2 border-white bg-white/10 hover:bg-red-600 hover:text-white transition-all duration-200 font-bold text-white"
                title="Close"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

        {/* Error display */}
        {error && (
          <div className="p-4 border-b-4 font-mono" style={{ backgroundColor: 'hsl(0, 75%, 95%)', color: 'hsl(0, 75%, 40%)', borderColor: 'hsl(0, 75%, 50%)' }}>
            <strong className="font-bold">ERROR:</strong> {error}
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
        <div className="p-4 border-t-4 border-primary" style={{ backgroundColor: 'hsl(220, 15%, 90%)' }}>
          {/* Image previews */}
          {attachedImages.length > 0 && (
            <div className="flex gap-2 mb-3 flex-wrap">
              {attachedImages.map((file, i) => (
                <div key={i} className="relative border-2 border-primary">
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="w-16 h-16 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setAttachedImages(files => files.filter((_, idx) => idx !== i))}
                    className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-5 h-5 text-xs font-bold border-2 border-white hover:bg-red-700"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                setAttachedImages(prev => [...prev, ...Array.from(e.target.files!)]);
              }
            }}
          />

          <form onSubmit={handleSubmit} className="flex gap-3">
            <Button
              type="button"
              variant="brutalist"
              onClick={() => fileInputRef.current?.click()}
              disabled={!isConnected}
              className="px-3"
            >
              <Paperclip className="w-4 h-4" />
            </Button>
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
          <p className="text-xs mt-2 font-mono" style={{ color: 'hsl(220, 20%, 45%)' }}>
            Reading from Claude Code session history. For full terminal control, switch to console view.
          </p>
        </div>
        </div>
      </div>
    </>
  );
}
