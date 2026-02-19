import { useRef, useState } from "react";
import type { Terminal } from "ghostty-web";
import { useConsole } from "@/hooks/use-console.ts";
import { X, MessageSquare } from "lucide-react";

type ConsoleProps = {
  sessionId: string;
  sessionName: string;
  onClose: () => void;
  onSwitchToChat?: () => void;
};


export function Console({
  sessionId,
  sessionName,
  onClose,
  onSwitchToChat,
}: ConsoleProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const { client, isConnected } = useConsole(sessionId);
  const [error, setError] = useState<string | null>(null);
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [errorKey] = useState<number>(0);

  // Set Sentry context for this session
  ;

  // Dismiss error function
  const dismissError = () => {
    setError(null);
    if (errorTimeoutRef.current != null) {
      clearTimeout(errorTimeoutRef.current);
    }
  };

  void client; // Used by terminal input handler when hooks are re-enabled

  // Update ref whenever client or connection state changes
  ;

  // Initialize terminal
  ;

  // Handle WebSocket data
  ;

  // Handle connection status changes
  ;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-background/85 backdrop-blur-sm" />
      <div className="fixed inset-0 flex items-center justify-center p-8 z-50">
        <div className="max-w-5xl w-full h-[85vh] flex flex-col border-4 border-primary bg-card console-brutalist-shadow">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b-4 border-primary bg-primary">
            <div className="flex items-center gap-4">
              <h2 className="text-2xl font-bold font-mono uppercase tracking-wider text-white">
                {sessionName}
              </h2>
              <div className="flex items-center gap-2 px-3 py-1 border-2 border-white bg-white/10">
                <div
                  className={`w-3 h-3 border-2 border-white ${
                    isConnected
                      ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"
                      : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
                  }`}
                />
                <span className="text-sm font-mono font-bold uppercase text-white">
                  {isConnected ? "Online" : "Offline"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onSwitchToChat != null && (
                <button
                  onClick={onSwitchToChat}
                  className="cursor-pointer p-2 border-2 border-white bg-white/10 hover:bg-blue-600 hover:text-white transition-all duration-200 font-bold text-white"
                  title="Switch to chat view"
                  aria-label="Switch to chat view"
                >
                  <MessageSquare className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={onClose}
                className="cursor-pointer p-2 border-2 border-white bg-white/10 hover:bg-red-600 hover:text-white transition-all duration-200 font-bold text-white"
                title="Close console"
                aria-label="Close console"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Error display */}
          {error != null && error.length > 0 && (
            <div
              key={errorKey}
              className="p-4 border-b-4 font-mono flex items-start justify-between gap-4 bg-destructive/10 text-destructive border-destructive"
            >
              <div className="flex-1">
                <strong className="font-bold">ERROR:</strong> {error}
                <div className="text-xs mt-1 opacity-70">
                  Auto-dismisses in 10s or click × to dismiss
                </div>
              </div>
              <button
                onClick={dismissError}
                className="cursor-pointer p-1 hover:bg-red-600 hover:text-white transition-all duration-200 font-bold"
                title="Dismiss error"
                aria-label="Dismiss error"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Terminal */}
          <div
            className="flex-1 relative terminal-retro"
            style={{ minHeight: 0 }}
          >
            <div
              ref={terminalRef}
              className="absolute inset-2"
              onPointerDown={() => terminalInstanceRef.current?.focus()}
            />
          </div>

          {/* Footer */}
          <div className="p-4 border-t-4 border-primary text-sm bg-muted">
            <p className="font-mono text-muted-foreground">
              <kbd className="px-2 py-1 border-2 font-bold mr-2 bg-primary text-primary-foreground border-primary">
                CTRL+C
              </kbd>
              <span className="text-foreground">interrupt signal</span>
              <span className="mx-3">│</span>
              <span className="text-foreground">
                Close to detach (session persists)
              </span>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
