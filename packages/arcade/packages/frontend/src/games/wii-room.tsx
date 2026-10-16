import type { GameRoomModel } from "#src/room.tsx";
import {
  GameStage,
  GameControls,
  GameRecords,
  RoomAccount,
  RoomStatus,
  RoomNotice,
} from "#src/room.tsx";
import { WiiPage } from "./racing.tsx";
import "./wii-room.css";

export function WiiRoom({ model }: { readonly model: GameRoomModel }) {
  return (
    <div className="game-room game-room--mkwii">
      <header className="wii-topbar">
        <a href="/">◀ Arcade menu</a>
        <RoomAccount model={model} />
      </header>
      <main className="wii-channel">
        <div className="wii-title">
          <span className="wii-logotype">Wii</span>
          <div>
            <p>MARIO KART CHANNEL</p>
            <h1>Ready. Set. Wii.</h1>
          </div>
          <RoomStatus model={model} />
        </div>
        <nav className="wii-navigation" aria-label="Mario Kart Wii sections">
          <a href="#wii-race">Race</a>
          <a href="#wii-controllers">Controllers</a>
          <a href="#wii-records">Records</a>
        </nav>
        <RoomNotice model={model} />
        <div className="wii-race-layout" id="wii-race">
          <div className="wii-screen">
            <GameStage
              model={model}
              art={
                <div className="wii-wheel">
                  <span>
                    MARIO
                    <br />
                    <b>KART</b>
                  </span>
                </div>
              }
            />
          </div>
          <aside className="wii-race-data" aria-label="Race control">
            {model.room && <WiiPage room={model.room} stats={model.stats} />}
          </aside>
        </div>
        <section id="wii-controllers" className="wii-controllers">
          <h2>Choose your driver</h2>
          <p>A controller for everyone. A little friendly competition.</p>
          <GameControls model={model} />
        </section>
        <div id="wii-records">
          <GameRecords model={model} />
        </div>
      </main>
      <footer className="wii-footer">
        <a href="/">◀ Wii menu / Arcade</a>
        <span>MARIO KART Wii</span>
      </footer>
    </div>
  );
}
