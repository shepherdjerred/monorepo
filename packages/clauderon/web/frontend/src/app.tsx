import { useState } from "react";
import type { Session } from "@clauderon/client";
import { AuthGuard } from "./components/auth-guard.tsx";
import { SessionList } from "./components/session-list.tsx";
import { CreateSessionDialog } from "./components/create-session-dialog.tsx";
import { Console } from "./components/console.tsx";
import { ChatInterface } from "./components/chat-interface.tsx";
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
    <>
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
    </>
  );
}

export function App() {
  return (
    <AuthGuard>
      <AppContent />
    </AuthGuard>
  );
}
