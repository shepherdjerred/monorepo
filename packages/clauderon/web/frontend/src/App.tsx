import { useState } from "react";
import type { Session } from "@clauderon/client";
import { AuthProvider } from "./contexts/AuthContext.tsx";
import { AuthGuard } from "./components/AuthGuard.tsx";
import { SessionProvider } from "./contexts/SessionContext.tsx";
import { FeatureFlagsProvider } from "./contexts/FeatureFlagsContext.tsx";
import { SessionList } from "./components/SessionList.tsx";
import { CreateSessionDialog } from "./components/CreateSessionDialog.tsx";
import { Console } from "./components/Console.tsx";
import { ChatInterface } from "./components/ChatInterface.tsx";
import { Toaster } from "sonner";

type View = "list" | "console" | "chat";

function AppContent() {
  const [view, setView] = useState<View>("list");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [attachedSession, setAttachedSession] = useState<Session | null>(null);

  const handleAttach = (session: Session) => {
    setAttachedSession(session);
    setView("console");
  };

  const handleDetach = () => {
    setAttachedSession(null);
    setView("list");
  };

  const handleSwitchToChat = () => {
    setView("chat");
  };

  const handleSwitchToConsole = () => {
    setView("console");
  };

  const handleCreateNew = () => {
    setShowCreateDialog(true);
  };

  const handleCloseDialog = () => {
    setShowCreateDialog(false);
  };

  return (
    <SessionProvider>
      <Toaster position="top-right" richColors />
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
        <SessionList onAttach={handleAttach} onCreateNew={handleCreateNew} />

        {view === "console" && attachedSession != null && (
          <Console
            sessionId={attachedSession.id}
            sessionName={attachedSession.name}
            onClose={handleDetach}
            onSwitchToChat={handleSwitchToChat}
          />
        )}

        {view === "chat" && attachedSession != null && (
          <ChatInterface
            sessionId={attachedSession.id}
            sessionName={attachedSession.name}
            onClose={handleDetach}
            onSwitchToConsole={handleSwitchToConsole}
          />
        )}

        {showCreateDialog && (
          <CreateSessionDialog onClose={handleCloseDialog} />
        )}
      </div>
    </SessionProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AuthGuard>
        <FeatureFlagsProvider>
          <AppContent />
        </FeatureFlagsProvider>
      </AuthGuard>
    </AuthProvider>
  );
}
