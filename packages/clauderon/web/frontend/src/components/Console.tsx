import { useEffect, useRef, useState } from "react";
import { init, Terminal, FitAddon } from "ghostty-web";
import { useConsole } from "../hooks/useConsole";
import { X, MessageSquare } from "lucide-react";
import * as Sentry from "@sentry/react";
import { DecodeError } from "@clauderon/client";

type ConsoleProps = {
  sessionId: string;
  sessionName: string;
  onClose: () => void;
  onSwitchToChat?: () => void;
}

/**
 * Convert technical error to user-friendly message
 */
function getUserFriendlyErrorMessage(error: Error): string {
  if (error instanceof DecodeError) {
    switch (error.stage) {
      case 'validation':
        return 'Received invalid data format from session. The session may be experiencing issues.';
      case 'base64':
        return 'Terminal output decode error. The session is still running, but some output may be lost.';
      case 'utf8':
        return 'Terminal encoding error. Some characters may not display correctly.';
    }
  }

  // Network/WebSocket errors
  if (error.message.includes('WebSocket')) {
    return 'Connection lost. Attempting to reconnect...';
  }

  // Default fallback
  return 'An unexpected error occurred. The session may still be running.';
}

export function Console({ sessionId, sessionName, onClose, onSwitchToChat }: ConsoleProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const initializingRef = useRef<boolean>(false);
  const { client, isConnected } = useConsole(sessionId);
  const [error, setError] = useState<string | null>(null);
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [errorKey, setErrorKey] = useState<number>(0);

  // Set Sentry context for this session
  useEffect(() => {
    Sentry.setContext('console_session', {
      session_id: sessionId,
      session_name: sessionName,
      connected_at: new Date().toISOString(),
    });

    return () => {
      // Clear context on unmount
      Sentry.setContext('console_session', null);
    };
  }, [sessionId, sessionName]);

  // Dismiss error function
  const dismissError = () => {
    setError(null);
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
    }
  };

  // Track current client and connection state for terminal input handler
  const clientRef = useRef({ client, isConnected });

  // Update ref whenever client or connection state changes
  useEffect(() => {
    clientRef.current = { client, isConnected };
  }, [client, isConnected]);

  // Get current theme from document
  const getCurrentTheme = (): 'light' | 'dark' => {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
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

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    // Prevent duplicate initialization - check both flags synchronously
    if (terminalInstanceRef.current || initializingRef.current) {
      return;
    }

    // Set flag synchronously to prevent race condition
    initializingRef.current = true;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const container = terminalRef.current;
      if (!container) return;

      // Clear any existing canvases in the container
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }

      // Initialize ghostty WASM
      await init();

      const currentTheme = getCurrentTheme();
      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: '"Berkeley Mono", Menlo, Monaco, "Courier New", monospace',
        theme: terminalThemes[currentTheme],
        scrollback: 10000,
        smoothScrollDuration: 0,  // Disable smooth scrolling
        rows: 24,  // Set explicit initial size
        cols: 80,
      });

    terminal.open(container);

    terminalInstanceRef.current = terminal;

    // Use FitAddon to automatically size terminal to container
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Fit terminal after a brief delay to ensure container has dimensions
    setTimeout(() => {
      fitAddon.fit();

      // Send size to backend
      if (clientRef.current.client && clientRef.current.isConnected) {
        clientRef.current.client.resize(
          terminal.rows,
          terminal.cols
        );
      }

      // Observe container size changes
      fitAddon.observeResize();

      // Focus the terminal
      terminal.focus();
    }, 250);

    // Handle terminal input
    terminal.onData((data) => {
      const { client: currentClient, isConnected: currentConnected } = clientRef.current;
      if (currentClient && currentConnected) {
        currentClient.write(data);
      }
    });

    // Handle terminal resize events
    terminal.onResize(({ rows, cols }) => {
      if (clientRef.current.client && clientRef.current.isConnected) {
        clientRef.current.client.resize(rows, cols);
      }
    });

    // Watch for theme changes and update terminal
    const observer = new MutationObserver(() => {
      const newTheme = getCurrentTheme();
      terminal.options.theme = terminalThemes[newTheme];
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

      cleanup = () => {
        observer.disconnect();
        fitAddon.dispose();
        terminal.dispose();
        terminalInstanceRef.current = null;
        initializingRef.current = false;
      };
    })();

    return () => {
      cleanup?.();
    };
  }, []);

  // Handle WebSocket data
  useEffect(() => {
    if (!client || !terminalInstanceRef.current) {
      return;
    }

    const unsubscribe = client.onData((data: string) => {
      const terminal = terminalInstanceRef.current;
      if (terminal) {
        terminal.write(data);
      }
    });

    const unsubscribeError = client.onError((err: Error) => {
      // Capture error in Sentry with rich context
      if (err instanceof DecodeError) {
        Sentry.captureException(err, {
          level: 'error',
          tags: {
            error_type: 'terminal_decode',
            decode_stage: err.stage,
            session_id: err.context.sessionId ?? 'unknown',
          },
          contexts: {
            decode: {
              stage: err.stage,
              data_length: err.context.dataLength,
              data_sample: err.context.dataSample,
              session_id: err.context.sessionId,
              session_name: sessionName,
            }
          }
        });
      } else {
        // Capture other errors with session context
        Sentry.captureException(err, {
          level: 'error',
          tags: {
            error_type: 'terminal_error',
            session_id: sessionId,
          },
          contexts: {
            session: {
              session_id: sessionId,
              session_name: sessionName,
            }
          }
        });
      }

      // Show user-friendly error message
      const userMessage = getUserFriendlyErrorMessage(err);
      setError(userMessage);
      setErrorKey(prev => prev + 1);

      // Clear any existing timeout
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }

      // Auto-dismiss error after 10 seconds to prevent UI clutter
      errorTimeoutRef.current = setTimeout(() => {
        setError(null);
      }, 10000);
    });

    return () => {
      unsubscribe();
      unsubscribeError();

      // Clean up timeout on unmount
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
    };
  }, [client, sessionId, sessionName]);

  // Handle connection status changes
  useEffect(() => {
    if (isConnected && terminalInstanceRef.current && client) {
      // Notify backend of terminal size
      client.resize(
        terminalInstanceRef.current.rows,
        terminalInstanceRef.current.cols
      );
    }
  }, [isConnected, client]);

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
            {onSwitchToChat && (
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
        {error && (
          <div
            key={errorKey}
            className="p-4 border-b-4 font-mono flex items-start justify-between gap-4"
            style={{
              backgroundColor: 'hsl(0, 75%, 95%)',
              color: 'hsl(0, 75%, 40%)',
              borderColor: 'hsl(0, 75%, 50%)'
            }}
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
        <div className="flex-1 relative terminal-retro" style={{ minHeight: 0 }}>
          <div
            ref={terminalRef}
            className="absolute inset-2"
            onClick={() => terminalInstanceRef.current?.focus()}
          />
        </div>

        {/* Footer */}
        <div className="p-4 border-t-4 border-primary text-sm" style={{ backgroundColor: 'hsl(220, 15%, 90%)' }}>
          <p className="font-mono" style={{ color: 'hsl(220, 20%, 45%)' }}>
            <kbd className="px-2 py-1 border-2 font-bold mr-2" style={{ backgroundColor: 'hsl(220, 85%, 25%)', color: 'white', borderColor: 'hsl(220, 85%, 25%)' }}>CTRL+C</kbd>
            <span style={{ color: 'hsl(220, 90%, 10%)' }}>interrupt signal</span>
            <span className="mx-3">│</span>
            <span style={{ color: 'hsl(220, 90%, 10%)' }}>Close to detach (session persists)</span>
          </p>
        </div>
        </div>
      </div>
    </>
  );
}
