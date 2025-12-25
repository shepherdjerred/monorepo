import type { User } from "../types";

interface AuthProps {
  user: User | null;
  loading: boolean;
  onLogin: () => void;
  onLogout: () => void;
}

export function Auth({ user, loading, onLogin, onLogout }: AuthProps) {
  if (loading) {
    return (
      <div style={styles.container}>
        <span style={styles.loading}>Loading...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={styles.container}>
        <button onClick={onLogin} style={styles.loginButton}>
          Sign in with GitHub
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.userInfo}>
        {user.avatarUrl && (
          <img src={user.avatarUrl} alt={user.username} style={styles.avatar} />
        )}
        <span style={styles.username}>{user.username}</span>
      </div>
      <button onClick={onLogout} style={styles.logoutButton}>
        Sign out
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "8px",
  },
  loading: {
    color: "#888",
  },
  loginButton: {
    background: "#238636",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    padding: "8px 16px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 500,
  },
  logoutButton: {
    background: "#333",
    color: "#fff",
    border: "1px solid #444",
    borderRadius: "6px",
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: "12px",
  },
  userInfo: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  avatar: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
  },
  username: {
    color: "#eee",
    fontSize: "14px",
  },
};
