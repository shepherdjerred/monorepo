import type { GameRoomModel } from "#src/room.tsx";
import {
  GameStage,
  GameSeats,
  GameController,
  GameRecords,
  RoomAccount,
  RoomStatus,
  RoomNotice,
} from "#src/room.tsx";
import { Mk64Page } from "./racing.tsx";
import "./mk64-room.css";

export function Mk64Room({ model }: { readonly model: GameRoomModel }) {
  return (
    <div className="game-room game-room--mk64">
      <header className="kart-topbar">
        <a className="kart-logo" href="/games/mk64" aria-label="Mario Kart 64">
          <span>
            MARIO KART <b>64</b>
          </span>
          <small>DISCORD GRAND PRIX</small>
        </a>
        <RoomStatus model={model} />
        <RoomAccount model={model} />
      </header>
      <main className="kart-paddock">
        <div className="kart-racing-column">
          <div className="kart-welcome">
            <div>
              <a href="/">← Back to Arcade</a>
              <h1>On your marks.</h1>
            </div>
            <span className="kart-cup" aria-hidden="true">
              ★
            </span>
          </div>
          <RoomNotice model={model} />
          <GameSeats model={model} />
          <GameStage model={model} art={<TrackScene />} />
          <GameController model={model} />
          {model.room && <Mk64Page room={model.room} stats={model.stats} />}
        </div>
        <aside className="kart-records" aria-label="Mario Kart records">
          <div className="kart-records-title">
            <span aria-hidden="true">♛</span>
            <div>
              <small>THE SERVER'S</small>
              <h2>Hall of fame</h2>
            </div>
          </div>
          <GameRecords model={model} />
        </aside>
      </main>
      <footer className="kart-footer">
        FOUR CONTROLLERS. ONE FINISH LINE. <a href="/">ARCADE ↗</a>
      </footer>
    </div>
  );
}

/** The previous MK64 start-line scene, expressed without a framework-specific skin. */
function TrackScene() {
  return (
    <div className="kart-track">
      <i className="kart-cloud cloud-one" />
      <i className="kart-cloud cloud-two" />
      <i className="kart-hill hill-one" />
      <i className="kart-hill hill-two" />
      <i className="kart-road" />
      <i className="kart-road-line" />
      <i className="kart-finish" />
    </div>
  );
}
