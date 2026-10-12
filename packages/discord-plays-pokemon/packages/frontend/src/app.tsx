import { useState } from "react";
import {
  useMe,
  signIn,
  useSignOut,
} from "@shepherdjerred/discord-plays-web/session/me.ts";
import { socket } from "./socket.ts";
import { useGame } from "./use-game.ts";
import { disabledReason } from "./game.ts";
import { Controller } from "./controller.tsx";
import { GameScreen } from "./game-screen.tsx";
import { ActivityPanels, Avatar, TrainerPanels } from "./trainer-panels.tsx";

export function App() {
  const { me, loading } = useMe();
  const signOut = useSignOut(socket);
  const game = useGame();
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const handleSignOut = async () => {
    setSigningOut(true);
    setAuthError(null);
    try {
      await signOut();
    } catch {
      setAuthError("Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  };
  return (
    <div className="page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Discord Plays Pokémon home">
          <span className="pokeball" aria-hidden="true" />
          <span>
            DISCORD PLAYS
            <strong>
              POKÉMON <em>EMERALD</em>
            </strong>
          </span>
        </a>
        <div className="identity">
          {me.signedIn ? (
            <>
              <Avatar user={me.user} />
              <span className="identity-name">{me.user.name}</span>
              <button
                className="quiet-button"
                type="button"
                disabled={signingOut}
                onClick={() => {
                  void handleSignOut();
                }}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </>
          ) : (
            <button type="button" onClick={signIn} disabled={loading}>
              {loading ? "Checking sign-in…" : "Sign in with Discord"}
            </button>
          )}
        </div>
      </header>
      <main>
        <div className="intro">
          <div>
            <p className="eyebrow">ONE SAVE. EVERYONE’S ADVENTURE.</p>
            <h1>
              A little chaos.
              <br />
              <span>A whole lot of Hoenn.</span>
            </h1>
          </div>
          <p>
            Join the voice channel, take the controls,
            <br className="desktop-break" /> and see where we end up together.
          </p>
        </div>
        {authError !== null && (
          <p className="notice" role="alert">
            {authError}
          </p>
        )}
        <div className="layout">
          <div className="main-column">
            <GameScreen game={game} signedIn={me.signedIn} />
            <Controller reason={disabledReason(game, me.signedIn)} />
            {game.notice !== null && (
              <p className="notice" role="status">
                {game.notice}
              </p>
            )}
            <TrainerPanels game={game} />
          </div>
          <aside className="side-column">
            <ActivityPanels game={game} />
          </aside>
        </div>
      </main>
      <footer className="page-footer">
        <span>Made for the journey, played together.</span>
        <span>Discord Plays Pokémon · Hoenn region</span>
      </footer>
    </div>
  );
}
