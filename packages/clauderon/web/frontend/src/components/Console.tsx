import { useEffect, useRef, useState } from "react";
import type { Terminal} from "ghostty-web";
import { init, FitAddon } from "ghostty-web";
import { useConsole } from "@shepherdjerred/clauderon/web/frontend/src/hooks/useConsole";
import { X, MessageSquare } from "lucide-react";
import * as Sentry from "@sentry/react";
import { DecodeError } from "@clauderon/client";

type ConsoleProps = {
  sessionId: string;
  sessionName: string;
  onClose: () => void;
  onSwitchToChat?: () => void;
};

// Terminal color themes
const terminalThemes = {
  light: {
    background: "#ffffff",
    foreground: "#1a1a1a",
    cursor: "#1a1a1a",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(33, 66, 131, 0.3)",
    black: "#000000",
    red: "#cd3131",
    green: "#00bc00",
    yellow: "#949800",
    blue: "#0451a5",
    magenta: "#bc05bc",
    cyan: "#0598bc",
    white: "#555555",
    brightBlack: "#666666",
    brightRed: "#cd3131",
    brightGreen: "#14ce14",
    brightYellow: "#b5ba00",
    brightBlue: "#0451a5",
    brightMagenta: "#bc05bc",
    brightCyan: "#0598bc",
    brightWhite: "#a5a5a5",
  },
  dark: {
    background: "#0a0e14",
    foreground: "#e6e1dc",
    cursor: "#00ff00",
    cursorAccent: "#000000",
    selectionBackground: "rgba(72, 118, 255, 0.3)",
    black: "#000000",
    red: "#ff3333",
    green: "#00ff00",
    yellow: "#ffff00",
    blue: "#0066ff",
    magenta: "#cc00ff",
    cyan: "#00ffff",
    white: "#cccccc",
    brightBlack: "#666666",
    brightRed: "#ff6666",
    brightGreen: "#66ff66",
    brightYellow: "#ffff66",
    brightBlue: "#6666ff",
    brightMagenta: "#ff66ff",
    brightCyan: "#66ffff",
    brightWhite: "#ffffff",
  },
};

/**
 * Convert technical error to user-friendly message
 */
function getUserFriendlyErrorMessage(error: Error): string {
  if (error instanceof DecodeError) {
    switch (error.stage) {
      case "validation":
        return "Received invalid data format from session. The session may be experiencing issues.";
      case "base64":
        return "Terminal output decode error. The session is still running, but some output may be lost.";
      case "utf8":
        return "Terminal encoding error. Some characters may not display correctly.";
    }
  }

  // Network/WebSocket errors
  if (error.message.includes("WebSocket")) {
    return "Connection lost. Attempting to reconnect...";
  }

  // Default fallback
  return "An unexpected error occurred. The session may still be running.";
}

// Get current theme from document
function getCurrentTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function Console({
  sessionId,
  sessionName,
  onClose,
  onSwitchToChat,
}: ConsoleProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const initializingRef = useRef<boolean>(false);
  const { client, isConnected } = useConsole(sessionId);
  const [error, setError] = useState<string | null>(null);
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [errorKey, setErrorKey] = useState<number>(0);

  // Set Sentry context for this session
  ;

  // Dismiss error function
  const dismissError = () => {
    setError(null);
    if (errorTimeoutRef.current != null) {
      clearTimeout(errorTimeoutRef.current);
    }
  };

  // Track current client and connection state for terminal input handler
  const clientRef = useRef({ client, isConnected });

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
