import { useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { useSessions } from "./hooks/useSessions";
import { useWebSocket } from "./hooks/useWebSocket";
import { Auth } from "./components/Auth";
import { Sessions } from "./components/Sessions";
import { Chat } from "./components/Chat";

export default function App() {
  const { user, loading: authLoading, login, logout } = useAuth();
  const {
    sessions,
    loading: sessionsLoading,
    createSession,
    stopSession,
    commitChanges,
    pushChanges,
    createPullRequest,
  } = useSessions();

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const {
    connected,
    messages,
    error: wsError,
    isProcessing,
    sendPrompt,
    interrupt,
  } = useWebSocket(activeSessionId);

  const handleCommit = async (message: string) => {
    if (!activeSessionId) throw new Error("No active session");
    await commitChanges(activeSessionId, message);
  };

  const handlePush = async () => {
    if (!activeSessionId) throw new Error("No active session");
    await pushChanges(activeSessionId);
  };

  const handleCreatePR = async (title: string, body: string) => {
    if (!activeSessionId) throw new Error("No active session");
    await createPullRequest(activeSessionId, title, body);
  };

  // Show login page if not authenticated
  if (authLoading) {
    return (
      <div style={styles.loading}>
        <div style={styles.spinner} />
        Loading...
      </div>
    );
  }

  if (!user) {
    return (
      <div style={styles.loginPage}>
        <div style={styles.loginCard}>
          <h1 style={styles.loginTitle}>Claude Web</h1>
          <p style={styles.loginDescription}>
            AI-powered development environment with GitHub integration
          </p>
          <button onClick={login} style={styles.loginButton}>
            Sign in with GitHub
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      {/* Top bar */}
      <header style={styles.header}>
        <h1 style={styles.logo}>Claude Web</h1>
        <Auth
          user={user}
          loading={authLoading}
          onLogin={login}
          onLogout={logout}
        />
      </header>

      {/* Main content */}
      <div style={styles.main}>
        {/* Sidebar */}
        <aside style={styles.sidebar}>
          <Sessions
            sessions={sessions}
            loading={sessionsLoading}
            activeSessionId={activeSessionId}
            onSelectSession={setActiveSessionId}
            onCreateSession={createSession}
            onStopSession={stopSession}
          />
        </aside>

        {/* Chat area */}
        <main style={styles.content}>
          {activeSessionId ? (
            <Chat
              messages={messages}
              connected={connected}
              isProcessing={isProcessing}
              error={wsError}
              onSendMessage={sendPrompt}
              onInterrupt={interrupt}
              onCommit={handleCommit}
              onPush={handlePush}
              onCreatePR={handleCreatePR}
            />
          ) : (
            <div style={styles.noSession}>
              <h2>Welcome to Claude Web</h2>
              <p>
                Create a new session or select an existing one to get started.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "#1a1a2e",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0 16px",
    height: "56px",
    background: "#0d0d14",
    borderBottom: "1px solid #333",
  },
  logo: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 600,
    color: "#eee",
  },
  main: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  sidebar: {
    width: "280px",
    flexShrink: 0,
  },
  content: {
    flex: 1,
    overflow: "hidden",
  },
  noSession: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#666",
    textAlign: "center",
    padding: "24px",
  },
  loading: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    gap: "16px",
    color: "#888",
    background: "#1a1a2e",
  },
  spinner: {
    width: "32px",
    height: "32px",
    border: "3px solid #333",
    borderTopColor: "#58a6ff",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  loginPage: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    background: "#0d0d14",
  },
  loginCard: {
    textAlign: "center",
    padding: "48px",
    background: "#1a1a2e",
    borderRadius: "12px",
    border: "1px solid #333",
    maxWidth: "400px",
  },
  loginTitle: {
    margin: "0 0 8px",
    fontSize: "32px",
    color: "#eee",
  },
  loginDescription: {
    margin: "0 0 32px",
    fontSize: "14px",
    color: "#888",
  },
  loginButton: {
    background: "#238636",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    padding: "12px 24px",
    fontSize: "16px",
    cursor: "pointer",
    fontWeight: 500,
  },
};
