import type { GameRoomModel } from "#src/room.tsx";
import {
  GameStage,
  GameControls,
  GameRecords,
  RoomAccount,
  RoomStatus,
  RoomNotice,
} from "#src/room.tsx";
import { MeleePage } from "./fighting.tsx";
import "./melee-room.css";

export function MeleeRoom({ model }: { readonly model: GameRoomModel }) {
  return (
    <div className="game-room game-room--melee">
      <header className="melee-topbar">
        <a href="/">ARCADE / VERSUS</a>
        <RoomStatus model={model} />
        <RoomAccount model={model} />
      </header>
      <main className="melee-arena">
        <div className="melee-title">
          <div>
            <p>SUPER SMASH BROS.</p>
            <h1>MELEE</h1>
          </div>
          <div className="melee-mode">
            <span>VS.</span>
            <small>
              FOUR CONTROLLERS
              <br />
              ONE ARENA
            </small>
          </div>
        </div>
        <RoomNotice model={model} />
        <div className="melee-match-layout">
          <section className="melee-match">
            <div className="melee-section-label">01 / BATTLE SCREEN</div>
            <GameStage
              model={model}
              art={
                <div className="melee-emblem">
                  <span />
                </div>
              }
            />
            <GameControls model={model} />
          </section>
          <aside className="melee-match-data" aria-label="Versus match status">
            <div className="melee-section-label">02 / CHALLENGERS</div>
            {model.room && <MeleePage room={model.room} stats={model.stats} />}
          </aside>
        </div>
        <section className="melee-records">
          <div className="melee-section-label">03 / VERSUS RECORDS</div>
          <GameRecords model={model} />
        </section>
      </main>
      <footer className="melee-footer">
        <span>READY FOR THE NEXT CHALLENGER?</span>
        <a href="/">RETURN TO ARCADE →</a>
      </footer>
    </div>
  );
}
