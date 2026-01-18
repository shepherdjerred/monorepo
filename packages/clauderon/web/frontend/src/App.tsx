import { useState } from "react";
import type { Session } from "@clauderon/client";
import { AuthProvider } from "./contexts/AuthContext";
import { AuthGuard } from "./components/AuthGuard";
import { SessionProvider } from "./contexts/SessionContext";
import { PreferencesProvider, usePreferences } from "./contexts/PreferencesContext";
import { SessionList } from "./components/SessionList";
import { CreateSessionDialog } from "./components/CreateSessionDialog";
import { FirstRunModal } from "./components/FirstRunModal";
import { Console } from "./components/Console";
import { ChatInterface } from "./components/ChatInterface";
import { Toaster } from "sonner";

type View = "list" | "console" | "chat";

function AppContent() {
  const [view, setView] = useState<View>("list");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [attachedSession, setAttachedSession] = useState<Session | null>(null);
  const { shouldShowFirstRun, completeFirstRun } = usePreferences();

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

  const handleFREComplete = () => {
    completeFirstRun();
  };

  const handleFRESkip = () => {
    completeFirstRun();
  };

  const handleFRECreateSession = () => {
    setShowCreateDialog(true);
  };

  return (
    <SessionProvider>
      <PreferencesProvider>
        <Toaster position="top-right" richColors />
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

          <FirstRunModal
            show={shouldShowFirstRun}
            onComplete={handleFREComplete}
            onSkip={handleFRESkip}
            onCreateSession={handleFRECreateSession}
          />
        </div>
      </PreferencesProvider>
    </SessionProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AuthGuard>
        <AppContent />
      </AuthGuard>
    </AuthProvider>
  );
}
