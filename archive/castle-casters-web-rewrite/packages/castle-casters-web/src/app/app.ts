import { applyTurn, chooseAiTurn, createMatch, generateValidTurns, type MatchState, type Turn } from "@castle-casters/core";
import { AudioMixer } from "#src/audio/audio.ts";
import { createRenderer, type CastleRenderer } from "#src/render/renderer.ts";
import { clearSavedMatch, loadSavedMatch, saveMatch } from "#src/storage/save.ts";
import "./styles.css";

type AppState = {
  match: MatchState;
  renderer?: CastleRenderer;
  selectedTurn?: Turn;
  aiThinking: boolean;
  mode: "single" | "multiplayer";
  scene: "teamIntro" | "mainMenu" | "help" | "game";
  lastAnnouncedWinner?: string;
};

export async function mountApp(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <section class="shell">
      <canvas class="game-canvas" aria-label="Castle Casters game board"></canvas>
      <div class="scene-overlay" data-overlay></div>
      <aside class="panel">
        <div>
          <h1>Castle Casters</h1>
          <p class="status" data-status>Loading</p>
        </div>
        <div class="controls">
          <button data-new>New</button>
          <button data-ai>AI Turn</button>
          <button data-save>Save</button>
          <button data-fullscreen>Fullscreen</button>
        </div>
        <div class="turn-list" data-turns></div>
      </aside>
    </section>
  `;

  const canvas = root.querySelector<HTMLCanvasElement>(".game-canvas");
  const status = root.querySelector<HTMLElement>("[data-status]");
  const turnList = root.querySelector<HTMLElement>("[data-turns]");
  const overlay = root.querySelector<HTMLElement>("[data-overlay]");
  if (canvas === null || status === null || turnList === null || overlay === null) {
    throw new Error("App shell failed to mount.");
  }
  const statusElement = status;
  const turnListElement = turnList;
  const overlayElement = overlay;

  const audio = new AudioMixer();
  const state: AppState = {
    match: loadSavedMatch(),
    aiThinking: false,
    mode: "single",
    scene: "teamIntro",
  };

  root.querySelector("[data-new]")?.addEventListener("click", () => {
    state.match = createMatch();
    delete state.lastAnnouncedWinner;
    clearSavedMatch();
    renderUi();
  });
  root.querySelector("[data-ai]")?.addEventListener("click", () => {
    doAiTurn(state);
    renderUi();
  });
  root.querySelector("[data-save]")?.addEventListener("click", () => {
    saveMatch(state.match);
    renderUi();
  });
  root.querySelector("[data-fullscreen]")?.addEventListener("click", () => {
    void root.requestFullscreen();
  });
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.dataset["action"];
    if (action === "skip-intro") {
      state.scene = "mainMenu";
      renderUi();
    }
    if (action === "play") {
      state.scene = "game";
      renderUi();
    }
    if (action === "help") {
      state.scene = "help";
      renderUi();
    }
    if (action === "menu") {
      state.scene = "mainMenu";
      renderUi();
    }
  });
  root.addEventListener("pointerdown", () => {
    void audio.unlock();
  });

  if (navigator.gpu === undefined) {
    statusElement.textContent = "WebGPU required. Try Chrome, Edge, or Safari 18+.";
    root.classList.add("unsupported");
    renderSceneOverlay(state, overlayElement);
    return;
  }

  try {
    state.renderer = await createRenderer(canvas);
  } catch {
    statusElement.textContent = "WebGPU required. Try Chrome, Edge, or Safari 18+.";
    root.classList.add("unsupported");
    renderSceneOverlay(state, overlayElement);
    return;
  }
  audio.playMusic("/assets/castle-casters/audio/music/theme.ogg");

  function renderUi(): void {
    renderSceneOverlay(state, overlayElement);
    statusElement.textContent =
      state.match.status.type === "victory"
        ? `${state.match.status.winner} wins`
        : state.aiThinking
          ? "AI is thinking"
          : `${state.match.activePlayer}'s turn`;
    if (state.match.status.type === "victory" && state.lastAnnouncedWinner !== state.match.status.winner) {
      state.lastAnnouncedWinner = state.match.status.winner;
      audio.playEffect("/assets/castle-casters/audio/music/victory.ogg");
    }
    const turns = generateValidTurns(state.match).slice(0, 24);
    turnListElement.innerHTML = "";
    for (const turn of turns) {
      const button = document.createElement("button");
      button.textContent = turn.type === "placeWall" ? `Wall ${turn.wall.start.x},${turn.wall.start.y}` : `Move ${turn.destination.x},${turn.destination.y}`;
      button.addEventListener("click", () => {
        state.match = applyTurn(state.match, turn);
        saveMatch(state.match);
        renderUi();
      });
      turnListElement.append(button);
    }
  }

  function frame(time: number): void {
    state.renderer?.render(state.match, time);
    requestAnimationFrame(frame);
  }

  renderUi();
  requestAnimationFrame(frame);
}

function doAiTurn(state: AppState): void {
  if (state.match.status.type === "victory") {
    return;
  }
  state.aiThinking = true;
  const result = chooseAiTurn(state.match, state.match.activePlayer, 1);
  state.match = applyTurn(state.match, result.turn);
  state.aiThinking = false;
  saveMatch(state.match);
}

function renderSceneOverlay(state: AppState, overlay: HTMLElement): void {
  overlay.dataset["scene"] = state.scene;
  if (state.scene === "game") {
    overlay.hidden = true;
    overlay.innerHTML = "";
    return;
  }
  overlay.hidden = false;
  if (state.scene === "teamIntro") {
    overlay.innerHTML = `
      <div class="intro-scene">
        <img src="/assets/castle-casters/textures/logos/team logo.png" alt="Team logo" />
        <button data-action="skip-intro">Continue</button>
      </div>
    `;
    return;
  }
  if (state.scene === "help") {
    overlay.innerHTML = `
      <div class="menu-scene">
        <h2>Help</h2>
        <p>Reach the opposite edge before the other caster. Place walls without blocking every path.</p>
        <button data-action="menu">Back</button>
      </div>
    `;
    return;
  }
  overlay.innerHTML = `
    <div class="menu-scene">
      <img src="/assets/castle-casters/textures/logos/game logo.png" alt="Castle Casters" />
      <button data-action="play">Play</button>
      <button data-action="help">Help</button>
    </div>
  `;
}
