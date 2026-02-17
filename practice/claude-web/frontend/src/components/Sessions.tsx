import { useState } from "react";
import type { Session } from "../types";

interface SessionsProps {
  sessions: Session[];
  loading: boolean;
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: (repoUrl: string, branch: string) => Promise<Session>;
  onStopSession: (sessionId: string) => Promise<void>;
}

export function Sessions({
  sessions,
  loading,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onStopSession,
}: SessionsProps) {
  const [showNewForm, setShowNewForm] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;

    setCreating(true);
    setError(null);

    try {
      const session = await onCreateSession(repoUrl, branch);
      onSelectSession(session.id);
      setShowNewForm(false);
      setRepoUrl("");
      setBranch("main");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setCreating(false);
    }
  };

  const handleStop = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      await onStopSession(sessionId);
    } catch (err) {
      console.error("Failed to stop session:", err);
    }
  };

  const getRepoName = (url: string) => {
    const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
    return match ? match[1] : url;
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Sessions</h2>
        <button
          onClick={() => setShowNewForm(!showNewForm)}
          style={styles.newButton}
        >
          {showNewForm ? "Cancel" : "+ New"}
        </button>
      </div>

      {showNewForm && (
        <form onSubmit={handleCreate} style={styles.form}>
          <input
            type="text"
            placeholder="Repository URL"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            style={styles.input}
            disabled={creating}
          />
          <input
            type="text"
            placeholder="Branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            style={styles.input}
            disabled={creating}
          />
          <button
            type="submit"
            disabled={creating || !repoUrl}
            style={styles.createButton}
          >
            {creating ? "Creating..." : "Create Session"}
          </button>
          {error && <div style={styles.error}>{error}</div>}
        </form>
      )}

      <div style={styles.list}>
        {loading ? (
          <div style={styles.empty}>Loading sessions...</div>
        ) : sessions.length === 0 ? (
          <div style={styles.empty}>No sessions yet</div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              onClick={() =>
                session.status === "running" && onSelectSession(session.id)
              }
              style={{
                ...styles.session,
                ...(activeSessionId === session.id ? styles.activeSession : {}),
                ...(session.status !== "running" ? styles.inactiveSession : {}),
              }}
            >
              <div style={styles.sessionInfo}>
                <div style={styles.repoName}>
                  {getRepoName(session.repoUrl)}
                </div>
                <div style={styles.branchName}>{session.branch}</div>
              </div>
              <div style={styles.sessionMeta}>
                <span
                  style={{
                    ...styles.status,
                    backgroundColor:
                      session.status === "running"
                        ? "#238636"
                        : session.status === "pending"
                          ? "#d29922"
                          : "#666",
                  }}
                >
                  {session.status}
                </span>
                {session.status === "running" && (
                  <button
                    onClick={(e) => handleStop(e, session.id)}
                    style={styles.stopButton}
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "#16161d",
    borderRight: "1px solid #333",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px",
    borderBottom: "1px solid #333",
  },
  title: {
    margin: 0,
    fontSize: "16px",
    color: "#eee",
  },
  newButton: {
    background: "#333",
    color: "#eee",
    border: "1px solid #444",
    borderRadius: "4px",
    padding: "4px 8px",
    cursor: "pointer",
    fontSize: "12px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px",
    borderBottom: "1px solid #333",
    background: "#1a1a24",
  },
  input: {
    background: "#222",
    border: "1px solid #444",
    borderRadius: "4px",
    padding: "8px",
    color: "#eee",
    fontSize: "13px",
  },
  createButton: {
    background: "#238636",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    padding: "8px",
    cursor: "pointer",
    fontSize: "13px",
  },
  error: {
    color: "#f85149",
    fontSize: "12px",
  },
  list: {
    flex: 1,
    overflow: "auto",
  },
  empty: {
    padding: "24px",
    textAlign: "center",
    color: "#666",
    fontSize: "13px",
  },
  session: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    borderBottom: "1px solid #222",
    cursor: "pointer",
    transition: "background 0.15s",
  },
  activeSession: {
    background: "#1e3a5f",
    borderLeft: "3px solid #58a6ff",
  },
  inactiveSession: {
    opacity: 0.5,
    cursor: "default",
  },
  sessionInfo: {
    flex: 1,
    minWidth: 0,
  },
  repoName: {
    fontSize: "13px",
    color: "#eee",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  branchName: {
    fontSize: "11px",
    color: "#888",
    marginTop: "2px",
  },
  sessionMeta: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginLeft: "8px",
  },
  status: {
    fontSize: "10px",
    padding: "2px 6px",
    borderRadius: "12px",
    color: "#fff",
    textTransform: "capitalize",
  },
  stopButton: {
    background: "#c93c37",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    padding: "2px 6px",
    cursor: "pointer",
    fontSize: "10px",
  },
};
