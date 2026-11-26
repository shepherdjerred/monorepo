import { useId, useState } from "react";
import type { SavedSession } from "./session.ts";

export function ConnectScreen(props: {
  initialOrigin: string;
  initialToken: string;
  initialRemember: boolean;
  error: string | null;
  busy: boolean;
  onSubmit: (session: SavedSession) => void;
}) {
  const [origin, setOrigin] = useState(props.initialOrigin);
  const [token, setToken] = useState(props.initialToken);
  const [remember, setRemember] = useState(props.initialRemember);
  const originId = useId();
  const tokenId = useId();
  const rememberId = useId();
  const originHintId = useId();
  const tokenHintId = useId();

  return (
    <main className="gate">
      <div className="gate-card">
        <p className="brand">TaskNotes</p>
        <h1 id="sign-in-title">Sign in</h1>
        <form
          aria-labelledby="sign-in-title"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit({ origin, token, remember });
          }}
        >
          <div className="field">
            <label htmlFor={originId}>Server</label>
            <input
              id={originId}
              name="origin"
              type="text"
              autoComplete="url"
              inputMode="url"
              spellCheck={false}
              value={origin}
              aria-describedby={originHintId}
              onChange={(event) => {
                setOrigin(event.target.value);
              }}
            />
            <p id={originHintId} className="hint">
              Local dev sends /api through this page to http://127.0.0.1:3000.
              Any other origin is called directly.
            </p>
          </div>
          <div className="field">
            <label htmlFor={tokenId}>Token</label>
            <input
              id={tokenId}
              name="token"
              type="password"
              autoComplete="current-password"
              spellCheck={false}
              value={token}
              aria-describedby={tokenHintId}
              onChange={(event) => {
                setToken(event.target.value);
              }}
            />
            <p id={tokenHintId} className="hint">
              Leave blank when the server has no AUTH_TOKEN. Otherwise paste the
              owner token or an fct_ token.
            </p>
          </div>
          <div className="remember-row">
            <input
              id={rememberId}
              name="remember"
              type="checkbox"
              checked={remember}
              onChange={(event) => {
                setRemember(event.target.checked);
              }}
            />
            <label htmlFor={rememberId}>
              <span>Remember on this browser</span>
            </label>
          </div>
          {props.error === null ? null : (
            <p className="alert" role="alert">
              {props.error}
            </p>
          )}
          <button className="primary" type="submit" disabled={props.busy}>
            {props.busy ? "Signing in…" : "Continue"}
          </button>
        </form>
      </div>
    </main>
  );
}
