import { useState, useCallback } from "react";
import { Search, Sparkles, Loader2 } from "lucide-react";
import { SurfaceProvider, useSurface, SurfaceRenderer } from "./a2ui";
import type { A2UIMessage, UserAction } from "./a2ui/types";

function KnowledgeExplorer() {
  const { surfaces, processMessage, clearSurfaces } = useSurface();
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExplore = useCallback(async () => {
    if (!query.trim()) return;

    setIsLoading(true);
    setError(null);
    clearSurfaces();

    try {
      const response = await fetch("/api/a2ui/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              const message: A2UIMessage = JSON.parse(line);
              processMessage(message);
            } catch (e) {
              console.error("Failed to parse message:", line, e);
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const message: A2UIMessage = JSON.parse(buffer);
          processMessage(message);
        } catch (e) {
          console.error("Failed to parse final message:", buffer, e);
        }
      }
    } catch (err) {
      console.error("Explore failed:", err);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  }, [query, processMessage, clearSurfaces]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isLoading) {
      handleExplore();
    }
  };

  // Get sorted surfaces for display
  const surfaceEntries = Array.from(surfaces.entries()).filter(
    ([, surface]) => surface.isRendering && surface.rootId
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-8 h-8 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">
              Knowledge Explorer
            </h1>
          </div>
          <p className="text-gray-600">
            Explore any topic with AI-generated interactive content
          </p>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Search input */}
        <div className="flex gap-3 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What would you like to explore? (e.g., Quantum Computing, Renaissance Art)"
              className="w-full pl-12 pr-4 py-4 bg-white border border-gray-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400 transition-shadow"
              disabled={isLoading}
            />
          </div>
          <button
            onClick={handleExplore}
            disabled={isLoading || !query.trim()}
            className="px-6 py-4 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 shadow-sm"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Exploring...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                Explore
              </>
            )}
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
            <p className="font-medium">Error</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="relative">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
              <Sparkles className="w-6 h-6 text-blue-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <p className="mt-4 text-gray-600 font-medium">
              AI is generating your interface...
            </p>
            <p className="mt-1 text-sm text-gray-500">
              This may take a few moments
            </p>
          </div>
        )}

        {/* Render A2UI surfaces */}
        <div className="space-y-6">
          {surfaceEntries.map(([surfaceId]) => (
            <SurfaceRenderer key={surfaceId} surfaceId={surfaceId} />
          ))}
        </div>

        {/* Empty state */}
        {surfaceEntries.length === 0 && !isLoading && !error && (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              <Search className="w-8 h-8 text-blue-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Start Exploring
            </h2>
            <p className="text-gray-600 max-w-md mx-auto">
              Enter a topic above to generate interactive content. Try
              &quot;Quantum Computing&quot;, &quot;Machine Learning&quot;, or &quot;Ancient Egypt&quot;.
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white/50 mt-auto">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <p className="text-center text-sm text-gray-500">
            Powered by A2UI Protocol • AI-generated interactive interfaces
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  const handleAction = async (action: UserAction): Promise<A2UIMessage[]> => {
    try {
      const response = await fetch("/api/a2ui/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAction: action }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json();
      return data.messages || [];
    } catch (error) {
      console.error("Action failed:", error);
      return [];
    }
  };

  return (
    <SurfaceProvider onAction={handleAction}>
      <KnowledgeExplorer />
    </SurfaceProvider>
  );
}
