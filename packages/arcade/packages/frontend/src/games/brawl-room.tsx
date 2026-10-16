import type { GameRoomModel } from "#src/room.tsx";
import {
  GameStage,
  GameControls,
  GameRecords,
  RoomAccount,
  RoomStatus,
  RoomNotice,
} from "#src/room.tsx";
import { BrawlPage } from "./fighting.tsx";
import "./brawl-room.css";

export function BrawlRoom({ model }: { readonly model: GameRoomModel }) {
  return (
    <div className="game-room game-room--brawl">
      <header className="brawl-topbar">
        <a href="/">← The Arcade</a>
        <RoomAccount model={model} />
      </header>
      <main className="brawl-hall">
        <div className="brawl-title">
          <p>SUPER SMASH BROS.</p>
          <h1>BRAWL</h1>
          <span>EVERY BATTLE HAS A STORY.</span>
          <RoomStatus model={model} />
        </div>
        <RoomNotice model={model} />
        <div className="brawl-battle-layout">
          <section className="brawl-battle">
            <div className="brawl-ribbon">THE BATTLEFIELD</div>
            <GameStage
              model={model}
              art={
                <div className="brawl-crest">
                  <span>SMASH</span>
                  <b>✦</b>
                  <small>BRING THE WHOLE CREW</small>
                </div>
              }
            />
            <GameControls model={model} />
          </section>
          <aside className="brawl-fighters" aria-label="Brawl fighters">
            {model.room && <BrawlPage room={model.room} stats={model.stats} />}
          </aside>
        </div>
        <section className="brawl-chronicles">
          <div className="brawl-chapter">
            <span>✦</span>
            <h2>The chronicles</h2>
            <span>✦</span>
          </div>
          <GameRecords model={model} />
        </section>
      </main>
      <footer className="brawl-footer">
        <span>A GOOD BRAWL. A BETTER STORY.</span>
        <a href="/">Back to the Arcade ↗</a>
      </footer>
    </div>
  );
}
