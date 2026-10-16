import type { GameRoomModel } from "#src/room.tsx";
import {
  AdventureGoal,
  GameStage,
  GameControls,
  RoomAccount,
  RoomStatus,
  RoomNotice,
} from "#src/room.tsx";
import { EmeraldPage } from "./emerald.tsx";
import "./emerald-room.css";

export function EmeraldRoom({ model }: { readonly model: GameRoomModel }) {
  return (
    <div className="game-room game-room--emerald">
      <div className="hoenn-page">
        <header className="hoenn-topbar">
          <a className="hoenn-brand" href="/games/emerald">
            <span className="hoenn-pokeball" aria-hidden="true" />
            <span>
              <small>DISCORD PLAYS</small>
              <strong>
                POKÉMON <em>EMERALD</em>
              </strong>
            </span>
          </a>
          <RoomAccount model={model} />
        </header>
        <main>
          <div className="hoenn-intro">
            <div>
              <a href="/">← Back to Arcade</a>
              <p className="eyebrow">ONE SAVE. EVERYONE'S ADVENTURE.</p>
              <h1>
                A little chaos.
                <br />
                <span>A whole lot of Hoenn.</span>
              </h1>
            </div>
            <div>
              <p>
                Join the voice channel, take the controls,
                <br />
                and see where we end up together.
              </p>
              <RoomStatus model={model} />
            </div>
          </div>
          <RoomNotice model={model} />
          <div className="hoenn-adventure">
            <div className="hoenn-main">
              <GameStage
                model={model}
                art={
                  <div className="hoenn-landscape">
                    <i />
                    <i />
                    <i />
                    <span>HOENN REGION</span>
                  </div>
                }
              />
              <GameControls model={model} />
              <AdventureGoal model={model} />
            </div>
            <aside
              className="hoenn-journal"
              aria-label="Trainer and adventure journal"
            >
              {model.room && (
                <EmeraldPage room={model.room} stats={model.stats} />
              )}
            </aside>
          </div>
        </main>
        <footer className="hoenn-footer">
          <span>Made for the journey, played together.</span>
          <a href="/">Arcade · Hoenn region</a>
        </footer>
      </div>
    </div>
  );
}
