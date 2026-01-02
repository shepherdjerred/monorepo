import { useState } from "react";
import type { Session } from "@clauderon/client";
import { SessionProvider } from "./contexts/SessionContext";
import { SessionList } from "./components/SessionList";
import { CreateSessionDialog } from "./components/CreateSessionDialog";
import { Console } from "./components/Console";
import { ChatInterface } from "./components/ChatInterface";

type View = "list" | "console" | "chat";

export function App() {
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
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
        <SessionList onAttach={handleAttach} onCreateNew={handleCreateNew} />

        {view === "console" && attachedSession && (
          <Console
            sessionId={attachedSession.id}
            sessionName={attachedSession.name}
            onClose={handleDetach}
            onSwitchToChat={handleSwitchToChat}
          />
        )}

        {view === "chat" && attachedSession && (
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
