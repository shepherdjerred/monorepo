import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@scout-for-lol/design-system/components/button";
import { ScoutThemeProvider } from "@scout-for-lol/design-system/runtime";
import type { ReplaySessionState } from "@scout-for-lol/replay";
import { createReplaySceneSession } from "@scout-for-lol/replay/scene";
import type { ReplayPresentationControls } from "../../../../packages/scout-for-lol/packages/app/src/components/replay/replay-controls.tsx";
import { ReplaySessionPlayer } from "../../../../packages/scout-for-lol/packages/app/src/components/replay/replay-player.tsx";
import { replayShareUrl } from "../../../../packages/scout-for-lol/packages/app/src/lib/replay/share-state.ts";
import {
  FreeCameraMap,
  type FreeCameraMapDot,
  type FreeCameraMapHandle,
} from "./scout-free-camera-map.tsx";
import {
  loadRenderer,
  loadSceneMotion,
  prepareScene,
  SceneSchema,
  type RendererModule,
  type TerrainScene,
} from "./scout-terrain-scene.ts";

const controls: ReplayPresentationControls = {
  rates: [0.5, 1, 2, 4],
  perspectives: ["all"],
  directedCamera: false,
};

async function get(path: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch(path, { signal, credentials: "omit" });
  if (!response.ok)
    throw new Error(
      `Could not load local terrain data (${response.status.toString()} at ${path}).`,
    );
  return response;
}

function PlayerScoreboard({
  participants,
  checkpoints,
  timeSeconds,
}: {
  participants: TerrainScene["participants"];
  checkpoints: NonNullable<
    ReturnType<typeof prepareScene>["playerCheckpoints"]
  >;
  timeSeconds: number;
}) {
  const current = checkpoints.findLast(
    (checkpoint) => checkpoint.timeSeconds <= timeSeconds,
  )?.players;
  const columns = [
    ["kills", "Kills", "K"],
    ["deaths", "Deaths", "D"],
    ["assists", "Assists", "A"],
    ["level", "Level", "Lv"],
  ] as const;

  return (
    <section aria-label="Replay scoreboard" className="space-y-2">
      <h2 className="font-semibold">Scoreboard</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {([100, 200] as const).map((team) => (
          <table
            key={team}
            className="w-full border-separate border-spacing-0 rounded-lg border border-scout-border text-sm"
          >
            <caption className="px-2 pb-1 text-left font-semibold">
              {team === 100 ? "Blue team" : "Red team"}
            </caption>
            <thead className="text-scout-subtle">
              <tr>
                <th scope="col" className="px-2 py-1.5 text-left font-medium">
                  Champion
                </th>
                {columns.map(([key, label, short]) => (
                  <th
                    key={key}
                    scope="col"
                    aria-label={label}
                    className="px-1 py-1.5 text-right font-medium"
                  >
                    {short}
                  </th>
                ))}
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {participants
                .filter(({ teamId }) => teamId === team)
                .map(({ participantId, championName }) => {
                  const state = current?.get(participantId);
                  return (
                    <tr key={participantId} data-participant-id={participantId}>
                      <th
                        scope="row"
                        className="border-t border-scout-border px-2 py-1.5 text-left font-medium"
                      >
                        {championName}
                      </th>
                      {columns.map(([key]) => (
                        <td
                          key={key}
                          className="border-t border-scout-border px-1 py-1.5 text-right tabular-nums"
                        >
                          {state?.[key] ?? "—"}
                        </td>
                      ))}
                      <td className="border-t border-scout-border px-2 py-1.5 text-right">
                        {state?.alive === true
                          ? "Alive"
                          : state?.alive === false
                            ? "Dead"
                            : "—"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        ))}
      </div>
      <p className="text-xs text-scout-subtle">
        A dash indicates unverified state.
      </p>
    </section>
  );
}

function TeamScore({
  kills,
  winner,
}: {
  kills: readonly (number | null)[];
  winner?: TerrainScene["winningTeam"];
}) {
  return (
    <section
      aria-label="Team kills"
      style={{
        position: "absolute",
        insetBlockStart: 8,
        insetInlineStart: "50%",
        transform: "translateX(-50%)",
        minWidth: "max-content",
        borderRadius: 6,
        padding: "4px 10px",
        background: "#111a23",
        color: "#f3f6f9",
        pointerEvents: "none",
        textAlign: "center",
        fontSize: "0.8125rem",
      }}
    >
      <dl style={{ display: "flex", gap: 12, margin: 0 }}>
        {(["Blue", "Red"] as const).map((side, index) => (
          <div
            key={side}
            data-score-side={side}
            style={{ display: "flex", gap: 5 }}
          >
            <dt style={{ color: side === "Blue" ? "#9ceaff" : "#ffb7c3" }}>
              {side}
            </dt>
            <dd
              style={{
                margin: 0,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {kills[index] ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
      {winner === undefined ? null : (
        <p data-match-result="" style={{ margin: 0 }}>
          {winner === 100 ? "Blue team wins" : "Red team wins"}
        </p>
      )}
    </section>
  );
}

function TerrainDemo({ data }: { data: ReturnType<typeof prepareScene> }) {
  const [shareResult, setShareResult] = useState("");
  const [mapTarget, setMapTarget] = useState<[number, number] | null>(null);
  const freeFocus = useRef<[number, number, number] | undefined>(undefined);
  const cameraMode = useRef<ReplaySessionState["camera"]["mode"]>("free");
  const [closeCamera, setCloseCamera] = useState(false);
  const closeCameraEnabled = useRef(false);
  const repaintCamera = useRef<(() => void) | undefined>(undefined);
  const minimap = useRef<FreeCameraMapHandle | null>(null);
  const latestMinimapDots = useRef<FreeCameraMapDot[]>([]);
  const attachMinimap = useCallback((handle: FreeCameraMapHandle | null) => {
    minimap.current = handle;
    handle?.drawDots(latestMinimapDots.current);
  }, []);
  const inhibitorSelectId = useId();
  const turretSelectId = useId();
  const decodedSelectId = useId();
  const {
    scene,
    trace,
    captured,
    decoded,
    positionsAt,
    worldUnitsAt,
    sampleFrame,
    cameraGroundAt,
    mapPointAt,
    turrets,
    turretLosses,
    dragons,
    inhibitorTimes,
    playerCheckpoints,
  } = data;
  const nexus = scene.nexusModels;
  const initialize = useCallback(
    async (canvas: HTMLCanvasElement, signal: AbortSignal) => {
      const source = "/terrain-renderer.mjs";
      const render = await (import(
        /* @vite-ignore */ source
      ) as Promise<RendererModule>);
      const renderer = await loadRenderer(
        canvas,
        scene,
        signal,
        (path) => get(path, signal).then((response) => response.arrayBuffer()),
        render,
      );
      let width = canvas.clientWidth;
      let height = canvas.clientHeight;
      let devicePixelRatio = globalThis.devicePixelRatio;
      let lastTime: number | null | undefined;
      let lastFocus: number | null = null;
      let lastLossCount = 0;
      let lastNexusCue = false;
      let paint: (() => void) | undefined;
      repaintCamera.current = () => paint?.();
      return createReplaySceneSession({
        canvas,
        trace,
        signal,
        sampling: "exact",
        ...(scene.motion === undefined ? {} : { sampleFrame }),
        presentation: {
          draw(frame, focusParticipantId) {
            const observedTime =
              frame.actors.length === 0 && scene.worldUnitModels === undefined
                ? null
                : frame.timeSeconds;
            const lossCount =
              scene.turretLosses?.filter(
                ({ timeSeconds }) => timeSeconds <= frame.timeSeconds,
              ).length ?? 0;
            const pastNexusCue =
              scene.nexusModels !== undefined &&
              frame.timeSeconds >= scene.nexusModels.cue.timeSeconds;
            if (
              lastTime === observedTime &&
              lastFocus === focusParticipantId &&
              lastLossCount === lossCount &&
              lastNexusCue === pastNexusCue
            )
              return;
            lastTime = observedTime;
            lastFocus = focusParticipantId;
            lastLossCount = lossCount;
            lastNexusCue = pastNexusCue;
            const observed = positionsAt(frame.timeSeconds);
            const visible = new Set(
              frame.actors.map(({ participantId }) => participantId),
            );
            const markers = observed.markers.filter(({ participantId }) =>
              visible.has(participantId),
            );
            if (scene.minimap === true) {
              latestMinimapDots.current = markers.flatMap(
                ({ participantId, position, teamId }) => {
                  const point = mapPointAt(position);
                  return point.every((value) => value >= 0 && value <= 1)
                    ? [{ participantId, teamId, point }]
                    : [];
                },
              );
              minimap.current?.drawDots(latestMinimapDots.current);
            }
            const focus = markers.find(
              ({ participantId }) => participantId === focusParticipantId,
            )?.position;
            const worldUnits = worldUnitsAt(frame.timeSeconds);
            paint = () => {
              const target =
                cameraMode.current === "free"
                  ? (freeFocus.current ?? focus)
                  : focus;
              renderer.draw(
                {
                  timeSeconds: frame.timeSeconds,
                  markers,
                  ...(worldUnits === undefined ? {} : { worldUnits }),
                },
                53,
                {
                  width,
                  height,
                  devicePixelRatio,
                  ...(target === undefined ? {} : { focus: target }),
                  ...(target !== undefined && closeCameraEnabled.current
                    ? { distance: 1100 }
                    : {}),
                },
              );
            };
            paint();
          },
          resize(nextWidth, nextHeight, nextDensity) {
            if (
              ![nextWidth, nextHeight, nextDensity].every(
                (value) => value > 0 && Number.isFinite(value),
              ) ||
              (width === nextWidth &&
                height === nextHeight &&
                devicePixelRatio === nextDensity)
            )
              return false;
            width = nextWidth;
            height = nextHeight;
            devicePixelRatio = nextDensity;
            lastTime = undefined;
            return true;
          },
          dispose: () => {
            repaintCamera.current = undefined;
            renderer.dispose();
          },
        },
      });
    },
    [mapPointAt, positionsAt, sampleFrame, scene, trace, worldUnitsAt],
  );

  function moveFreeCamera(target: [number, number] | null) {
    freeFocus.current = target === null ? undefined : cameraGroundAt(target);
    setMapTarget(target);
    repaintCamera.current?.();
  }

  async function copyShare(state: ReplaySessionState) {
    try {
      await navigator.clipboard.writeText(replayShareUrl(location.href, state));
      setShareResult("Replay link copied.");
    } catch {
      setShareResult("Could not copy the replay link.");
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] space-y-5 px-4 py-6 sm:px-8">
      <header className="space-y-2">
        <p className="text-sm font-medium text-scout-brand">
          Scout · Local replay research
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Summoner’s Rift terrain
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-scout-subtle">
          Build {scene.identity.build} ·{" "}
          {scene.terrainMaterials === undefined
            ? "Untextured Map11 geometry"
            : "Map11 geometry with authored diffuse textures"}
          .{" "}
          {scene.championModels === undefined
            ? "Markers show "
            : "Original skin meshes in their bind pose show "}
          {[
            captured.size > 0 && "captured camera attachments",
            decoded.size > 0 &&
              "living champion positions decoded from replay keyframes",
          ]
            .filter(Boolean)
            .join(" or ")}{" "}
          at exact replay times.{" "}
          {scene.motion === undefined
            ? "Participant follow returns to the map overview between observations."
            : "Between keyframes, positions follow decoded movement paths or use the latest known position, with height from navigation terrain. Participant follow returns to the map overview when the selected position is unavailable."}{" "}
          Directed camera, team vision, and audio are unavailable.
          {scene.structureModels !== undefined
            ? " Authored turret models are visible until their recorded destruction."
            : scene.turretLosses === undefined
              ? null
              : " Amber squares show verified turret placements until their recorded losses."}
          {nexus !== undefined
            ? " Nexus models show their intact pose up to the recorded death cue."
            : null}
        </p>
      </header>
      <ReplaySessionPlayer
        initialize={initialize}
        search={location.search}
        controls={controls}
        onState={({ camera }) => {
          if (cameraMode.current === camera.mode) return;
          cameraMode.current = camera.mode;
          repaintCamera.current?.();
        }}
        renderCanvasOverlay={(state) => {
          const checkpoint = playerCheckpoints?.findLast(
            ({ timeSeconds }) => timeSeconds <= state.timeSeconds,
          );
          if (checkpoint === undefined) return null;
          return (
            <TeamScore
              kills={checkpoint.teamKills}
              winner={
                state.timeSeconds >= state.durationSeconds
                  ? scene.winningTeam
                  : undefined
              }
            />
          );
        }}
        renderTimelineExtras={(state, seek) => {
          const attachment = captured.get(state.timeSeconds);
          const keyframe = decoded.get(state.timeSeconds);
          const motionCount =
            scene.motion === undefined
              ? 0
              : positionsAt(state.timeSeconds).markers.length;
          const status = attachment
            ? `${attachment.markers.length.toString()} captured camera attachments at ${attachment.timeSeconds.toFixed(3)} s.`
            : keyframe
              ? `${keyframe.markers.length.toString()} decoded champion positions at ${keyframe.timeSeconds.toFixed(3)} s.`
              : motionCount > 0
                ? `${motionCount.toString()} champion positions from replay movement data.`
                : "No positions at this replay time.";
          return (
            <div className="basis-full space-y-3">
              <p role="status" className="text-sm text-scout-subtle">
                {status}
              </p>
              {scene.minimap === true && state.camera.mode === "free" && (
                <FreeCameraMap
                  mapHandle={attachMinimap}
                  target={mapTarget}
                  turrets={turrets?.filter(
                    ({ destroyedAtSeconds }) =>
                      destroyedAtSeconds === null ||
                      state.timeSeconds < destroyedAtSeconds,
                  )}
                  onMove={moveFreeCamera}
                  onReset={() => moveFreeCamera(null)}
                />
              )}
              {((scene.championModels !== undefined &&
                state.camera.mode === "follow") ||
                ((scene.structureModels !== undefined || nexus !== undefined) &&
                  state.camera.mode === "free" &&
                  mapTarget !== null)) && (
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-pressed={closeCamera}
                    onClick={() => {
                      const enabled = !closeCameraEnabled.current;
                      closeCameraEnabled.current = enabled;
                      setCloseCamera(enabled);
                      repaintCamera.current?.();
                    }}
                  >
                    {state.camera.mode === "follow"
                      ? "Close-up follow"
                      : "Close-up camera"}
                  </Button>
                </div>
              )}
              {captured.size > 0 && (
                <div
                  role="group"
                  aria-label="Captured replay times"
                  className="flex flex-wrap gap-2"
                >
                  {[...captured.keys()].map((time) => (
                    <Button
                      key={time}
                      variant="outline"
                      size="sm"
                      aria-pressed={state.timeSeconds === time}
                      onClick={() => {
                        void seek(time);
                      }}
                    >
                      {time.toFixed(3)} s
                    </Button>
                  ))}
                </div>
              )}
              {decoded.size > 0 && (
                <div className="space-y-1">
                  <label
                    htmlFor={decodedSelectId}
                    className="block text-xs text-scout-subtle"
                  >
                    Decoded champion positions
                  </label>
                  <select
                    id={decodedSelectId}
                    value={
                      decoded.has(state.timeSeconds)
                        ? String(state.timeSeconds)
                        : ""
                    }
                    className="max-w-full rounded-md border border-scout-border bg-scout-canvas p-2 text-base text-scout-ink"
                    style={{ minBlockSize: "48px" }}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      if (value !== "" && decoded.has(Number(value)))
                        void seek(Number(value));
                    }}
                  >
                    <option value="" disabled>
                      Choose a replay keyframe
                    </option>
                    {[...decoded.keys()].map((time) => (
                      <option key={time} value={time}>
                        {time.toFixed(3)} s
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {dragons.size > 0 && (
                <label className="block space-y-1 text-xs text-scout-subtle">
                  <span className="block">Recorded dragon kills</span>
                  <select
                    value={
                      dragons.has(state.timeSeconds)
                        ? state.timeSeconds.toString()
                        : ""
                    }
                    className="max-w-full rounded-md border border-scout-border bg-scout-canvas p-2 text-sm text-scout-ink"
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      if (value !== "" && dragons.has(Number(value)))
                        void seek(Number(value));
                    }}
                  >
                    <option value="" disabled>
                      Choose a recorded kill
                    </option>
                    {[...dragons].map(([time, champion]) => (
                      <option key={time} value={time}>
                        {champion} · {time.toFixed(3)} s
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {turretLosses.length > 0 && (
                <div className="space-y-1">
                  <label
                    htmlFor={turretSelectId}
                    className="block text-xs text-scout-subtle"
                  >
                    Recorded turret losses
                  </label>
                  <select
                    id={turretSelectId}
                    value={
                      turretLosses.find(
                        (event) => event.timeSeconds === state.timeSeconds,
                      )?.context ?? ""
                    }
                    className="max-w-full rounded-md border border-scout-border bg-scout-canvas p-2 text-base text-scout-ink"
                    style={{ minBlockSize: "48px" }}
                    onChange={(event) => {
                      const context = Number(event.currentTarget.value);
                      const loss = turretLosses.find(
                        (entry) => entry.context === context,
                      );
                      if (loss === undefined) return;
                      if (
                        scene.minimap === true &&
                        state.camera.mode === "free"
                      )
                        moveFreeCamera(loss.point);
                      void seek(loss.timeSeconds);
                    }}
                  >
                    <option value="" disabled>
                      Choose a recorded loss
                    </option>
                    {turretLosses.map(({ context, timeSeconds }) => (
                      <option key={context} value={context}>
                        {timeSeconds.toFixed(3)} s
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {nexus !== undefined && (
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const { instances, cue } = nexus;
                      const target = instances.find(
                        ({ context }) => context === cue.context,
                      );
                      if (target === undefined)
                        throw new Error("Nexus cue has no original placement.");
                      if (
                        scene.minimap === true &&
                        state.camera.mode === "free"
                      )
                        moveFreeCamera(mapPointAt(target.position));
                      void seek(cue.timeSeconds);
                    }}
                  >
                    Jump to Nexus death cue
                  </Button>
                </div>
              )}
              {inhibitorTimes === undefined ? null : (
                <div className="space-y-1">
                  {inhibitorTimes.length > 0 && (
                    <>
                      <label
                        htmlFor={inhibitorSelectId}
                        className="block text-xs text-scout-subtle"
                      >
                        Recorded inhibitor losses
                      </label>
                      <select
                        id={inhibitorSelectId}
                        value={
                          inhibitorTimes.includes(state.timeSeconds)
                            ? String(state.timeSeconds)
                            : ""
                        }
                        className="max-w-full rounded-md border border-scout-border bg-scout-canvas p-2 text-base text-scout-ink"
                        style={{ minBlockSize: "48px" }}
                        onChange={(event) => {
                          const time = Number(event.currentTarget.value);
                          if (inhibitorTimes.includes(time)) void seek(time);
                        }}
                      >
                        <option value="" disabled>
                          Choose a recorded loss
                        </option>
                        {inhibitorTimes.map((time) => (
                          <option key={time} value={time}>
                            {time.toFixed(3)} s
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  <p className="text-sm text-scout-subtle">
                    Recorded inhibitor losses{" "}
                    {
                      inhibitorTimes.filter((time) => time <= state.timeSeconds)
                        .length
                    }
                  </p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void copyShare(state);
                  }}
                >
                  Copy replay link
                </Button>
                <span role="status" className="text-sm text-scout-subtle">
                  {shareResult}
                </span>
              </div>
              {playerCheckpoints === undefined ? null : (
                <PlayerScoreboard
                  participants={scene.participants}
                  checkpoints={playerCheckpoints}
                  timeSeconds={state.timeSeconds}
                />
              )}
            </div>
          );
        }}
      />
    </main>
  );
}

function App() {
  const [data, setData] = useState<ReturnType<typeof prepareScene> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        const response = await get("/scene.json", abort.signal);
        const { scene, heights } = await loadSceneMotion(
          SceneSchema.parse(await response.json()),
          abort.signal,
          {
            read: (path) =>
              get(path, abort.signal).then((response) =>
                response.arrayBuffer(),
              ),
            replay: () =>
              get("/replay-motion.rofl", abort.signal).then((response) =>
                response.arrayBuffer(),
              ),
            worker: async () =>
              new Worker("/replay-motion-worker.mjs", { type: "module" }),
          },
        );
        if (!abort.signal.aborted) setData(prepareScene(scene, heights));
      } catch (cause) {
        if (!abort.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load local replay terrain.",
          );
      }
    }
    void load();
    return () => {
      abort.abort();
    };
  }, []);
  return (
    <ScoutThemeProvider surface="app">
      {error !== null ? (
        <p role="alert">{error}</p>
      ) : data === null ? (
        <p role="status">Loading local replay terrain…</p>
      ) : (
        <TerrainDemo data={data} />
      )}
    </ScoutThemeProvider>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("Scout replay demo root is missing.");
createRoot(root).render(<App />);
