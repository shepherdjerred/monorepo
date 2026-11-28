import { useId, useState } from "react";
import { FacetMark, Icon } from "./icons.tsx";
import type { SavedSession } from "#sync/session.ts";

export function ConnectScreen(props: {
  initialOrigin: string;
  initialToken: string;
  initialRemember: boolean;
  error: string | null;
  busy: boolean;
  onSubmit: (session: SavedSession) => void;
  onContinueLocally?: () => void;
  embedded?: boolean;
}) {
  const [origin, setOrigin] = useState(props.initialOrigin);
  const [token, setToken] = useState(props.initialToken);
  const [remember, setRemember] = useState(props.initialRemember);
  const originId = useId();
  const tokenId = useId();
  const signInId = useId();
  const tokenHintId = useId();
  const errorId = useId();
  const Heading = props.embedded === true ? "h2" : "h1";

  const card = (
    <section
      className={
        props.embedded === true ? "gate-card gate-card-embedded" : "gate-card"
      }
      aria-labelledby={signInId}
    >
      <div className="gate-brand">
        <FacetMark />
        <span>Facet</span>
      </div>
      <div className="gate-heading">
        <Heading id={signInId}>Sign in to Facet</Heading>
        <p>Enter your access token to open your workspace.</p>
      </div>
      <form
        aria-labelledby={signInId}
        aria-busy={props.busy}
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit({
            origin: origin.trim(),
            token: token.trim(),
            remember,
          });
        }}
      >
        <div className="field">
          <label htmlFor={tokenId}>Access token</label>
          <input
            id={tokenId}
            name="token"
            type="password"
            autoComplete="current-password"
            spellCheck={false}
            value={token}
            aria-describedby={
              props.error === null
                ? tokenHintId
                : [tokenHintId, errorId].join(" ")
            }
            onChange={(event) => {
              setToken(event.target.value);
            }}
          />
          <p id={tokenHintId} className="hint">
            Use the same token you use to connect Facet on your other devices.
          </p>
        </div>
        {props.error === null ? null : (
          <p id={errorId} className="alert" role="alert">
            {props.error}
          </p>
        )}
        <label className="remember-row">
          <input
            name="remember"
            type="checkbox"
            checked={remember}
            onChange={(event) => {
              setRemember(event.target.checked);
            }}
          />
          Remember on this browser
        </label>
        <button
          className="primary gate-submit"
          type="submit"
          disabled={props.busy}
        >
          {props.busy ? "Signing in…" : "Sign in"}
          <Icon name="arrow-right" />
        </button>
        <details
          className="gate-advanced"
          open={props.initialOrigin !== "" || undefined}
        >
          <summary>Advanced connection settings</summary>
          <div className="field">
            <label htmlFor={originId}>Server URL</label>
            <input
              id={originId}
              name="origin"
              type="url"
              autoComplete="url"
              inputMode="url"
              spellCheck={false}
              placeholder="https://tasknotes.tailnet-1a49.ts.net"
              value={origin}
              onInvalid={(event) => {
                const advanced = event.currentTarget.closest("details");
                if (advanced !== null) advanced.open = true;
              }}
              onChange={(event) => {
                setOrigin(event.target.value);
              }}
            />
          </div>
        </details>
      </form>
      {props.onContinueLocally === undefined ? null : (
        <div className="gate-local">
          <button
            className="secondary"
            type="button"
            disabled={props.busy}
            onClick={props.onContinueLocally}
          >
            Continue locally
          </button>
          <p className="hint">
            Tasks stay in this browser until you connect a workspace.
          </p>
        </div>
      )}
    </section>
  );
  return props.embedded === true ? card : <main className="gate">{card}</main>;
}
