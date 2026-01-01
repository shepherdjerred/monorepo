import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useConsole } from "../hooks/useConsole";
import "@xterm/xterm/css/xterm.css";
import { X } from "lucide-react";

type ConsoleProps = {
  sessionId: string;
  sessionName: string;
  onClose: () => void;
}

export function Console({ sessionId, sessionName, onClose }: ConsoleProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { client, isConnected } = useConsole(sessionId);
  const [error, setError] = useState<string | null>(null);

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

    const currentTheme = getCurrentTheme();
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Berkeley Mono", Menlo, Monaco, "Courier New", monospace',
      theme: terminalThemes[currentTheme],
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(terminalRef.current);
    fitAddon.fit();

    terminalInstanceRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Handle terminal input
    terminal.onData((data) => {
      const { client: currentClient, isConnected: currentConnected } = clientRef.current;
      if (currentClient && currentConnected) {
        currentClient.write(data);
      }
    });

    // Handle window resize
    const handleResize = () => {
      fitAddon.fit();
      if (client && isConnected) {
        client.resize(terminal.rows, terminal.cols);
      }
    };

    window.addEventListener("resize", handleResize);

    // Watch for theme changes and update terminal
    const observer = new MutationObserver(() => {
      const newTheme = getCurrentTheme();
      terminal.options.theme = terminalThemes[newTheme];
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
      terminal.dispose();
    };
  }, []);

  // Handle WebSocket data
  useEffect(() => {
    if (!client || !terminalInstanceRef.current) {
      return;
    }

    const unsubscribe = client.onData((data) => {
      terminalInstanceRef.current?.write(data);
    });

    const unsubscribeError = client.onError((err) => {
      setError(err.message);
    });

    return () => {
      unsubscribe();
      unsubscribeError();
    };
  }, [client]);

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-card rounded-lg max-w-6xl w-full h-[80vh] flex flex-col border-4 border-primary">
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
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-md transition-colors border-2 border-transparent hover:border-border"
            title="Close console"
            aria-label="Close console"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div className="p-4 bg-destructive/10 text-destructive border-b-2 border-destructive">
            <strong className="font-mono">Error:</strong> {error}
          </div>
        )}

        {/* Terminal */}
        <div className="flex-1 p-4 overflow-hidden">
          <div
            ref={terminalRef}
            className="terminal-retro w-full h-full rounded-sm overflow-hidden"
          />
        </div>

        {/* Footer */}
        <div className="p-4 border-t-4 border-primary text-sm">
          <p className="font-mono">
            Press <kbd className="px-2 py-1 bg-secondary border-2 border-foreground rounded font-bold">Ctrl+C</kbd>{" "}
            to send interrupt signal. Close this window to detach (session continues running).
          </p>
        </div>
      </div>
    </div>
  );
}
