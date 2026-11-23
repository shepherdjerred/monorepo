import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReplaySession, ReplaySessionState } from "@scout-for-lol/replay";
import { Button } from "@scout-for-lol/design-system/components/button";
import { ReplayPageView } from "./replay-page-view.tsx";
import { ReplayControls } from "./replay-controls.tsx";
import {
  ReplayAnalysis,
  ReplayResearchCombatAnalysis,
} from "./replay-analysis.tsx";
import { runReplayCommand } from "#src/lib/replay/commands.ts";
import { replayFixture } from "#src/lib/replay/replay-fixture.ts";
import { ReplaySessionPlayer } from "./replay-player.tsx";
import { ReplayRuntimeError } from "@scout-for-lol/replay/types";
import type { ReplayErrorListener } from "@scout-for-lol/replay";
import {
  createReplaySceneSession,
  parseReplaySceneTrace,
} from "@scout-for-lol/replay/scene";

const meta = {
  title: "Replay/Public player",
  component: ReplayPageView,
  args: { state: { status: "loaded", replay: replayFixture } },
} satisfies Meta<typeof ReplayPageView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SupportPreparing: Story = {};

export const ResearchScoreboard: Story = {
  render: () => (
    <ReplayResearchCombatAnalysis
      durationSeconds={30}
      search=""
      events={[
        {
          id: 1,
          timestampMs: 4000,
          champion: "Braum",
          type: "CHAMPION_KILL",
          partition: 0,
        },
      ]}
      returnsAvailable
      aliveCounts={null}
      turretsAvailable
      inhibitorsAvailable
      kdaTimeline={{
        actors: [
          { partition: 0, champion: "Braum" },
          { partition: 1, champion: null },
        ],
        checkpoints: [
          { timestampMs: 0, kda: [{ kills: 0, deaths: 0, assists: 0 }, null] },
          {
            timestampMs: 4000,
            kda: [{ kills: 1, deaths: 0, assists: 0 }, null],
          },
        ],
      }}
    />
  ),
};

const normalizedScene = parseReplaySceneTrace({
  durationSeconds: 16,
  width: 320,
  height: 180,
  participants: [
    {
      participantId: 1,
      name: "Blue marker",
      championName: "Circle",
      teamId: 100,
    },
    {
      participantId: 2,
      name: "Red marker",
      championName: "Circle",
      teamId: 200,
    },
  ],
  frames: [
    {
      timeSeconds: 0,
      actors: [
        { participantId: 1, x: 58, y: 62, visibleTo: ["blue", "red"] },
        { participantId: 2, x: 256, y: 118, visibleTo: ["red"] },
      ],
      directedParticipantId: 1,
    },
    {
      timeSeconds: 5,
      actors: [
        { participantId: 1, x: 145, y: 112, visibleTo: ["blue", "red"] },
        { participantId: 2, x: 174, y: 56, visibleTo: ["blue", "red"] },
      ],
      directedParticipantId: 2,
    },
    {
      timeSeconds: 16,
      actors: [
        { participantId: 1, x: 229, y: 130, visibleTo: ["blue"] },
        { participantId: 2, x: 72, y: 86, visibleTo: ["blue", "red"] },
      ],
      directedParticipantId: 2,
    },
  ],
});

function loadNormalizedScene(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
): Promise<ReplaySession> {
  return Promise.resolve().then(() =>
    createReplaySceneSession({ canvas, trace: normalizedScene, signal }),
  );
}

export const NormalizedScene: Story = {
  render: () => (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">Normalized replay scene fixture</h1>
      <ReplaySessionPlayer initialize={loadNormalizedScene} search="?t=4" />
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const play = await canvas.findByRole("button", { name: "Play" });
    const time = canvas.getByRole("slider");
    const scene = canvas.getByLabelText("League of Legends replay scene");
    if (
      !(scene instanceof HTMLCanvasElement) ||
      !(time instanceof HTMLInputElement)
    )
      throw new TypeError("Expected the scene canvas and replay slider");
    await expect(time).toHaveValue("4");

    const speed = canvas.getByRole("combobox", { name: "Speed" });
    await userEvent.selectOptions(speed, "2");
    await expect(speed).toHaveValue("2");
    const vision = canvas.getByRole("combobox", { name: "Vision" });
    const allVision = scene.toDataURL();
    await userEvent.selectOptions(vision, "blue");
    await expect(vision).toHaveValue("blue");
    await expect(scene.toDataURL()).not.toBe(allVision);
    const camera = canvas.getByRole("combobox", { name: "Camera" });
    await userEvent.selectOptions(camera, "directed");
    await expect(camera).toHaveValue("directed");
    await userEvent.selectOptions(camera, "player:1");
    await expect(camera).toHaveValue("player:1");

    await userEvent.click(play);
    await waitFor(async () => {
      await expect(time.valueAsNumber).toBeGreaterThanOrEqual(5);
    });
    await userEvent.click(canvas.getByRole("button", { name: "Pause" }));
    await expect(canvas.getByRole("button", { name: "Play" })).toBeVisible();
  },
};

export const AnalysisTimeline: Story = {
  args: {
    analysis: (
      <ReplayAnalysis
        search="?t=735.860"
        durationSeconds={1320}
        state={{
          status: "ready",
          timeline: {
            source: "riot_match_timeline",
            events: [
              {
                id: 1,
                timestampMs: 114_205,
                type: "CHAMPION_KILL",
                objective: null,
                teamId: 100,
              },
              {
                id: 2,
                timestampMs: 520_144,
                type: "ELITE_MONSTER_KILL",
                objective: "AIR_DRAGON",
                teamId: 200,
              },
              {
                id: 3,
                timestampMs: 735_860,
                type: "BUILDING_KILL",
                objective: "OUTER_TURRET",
                teamId: 100,
              },
              {
                id: 4,
                timestampMs: 1_022_653,
                type: "CHAMPION_KILL",
                objective: null,
                teamId: 200,
              },
              {
                id: 5,
                timestampMs: 1_320_000,
                type: "GAME_END",
                objective: null,
                teamId: 100,
              },
            ],
          },
        }}
      />
    ),
  },
};

export const Loading: Story = { args: { state: { status: "loading" } } };
export const MissingReplay: Story = {
  args: {
    state: { status: "error", message: "This replay is not available." },
    onRetry: () => {
      /* This isolated state has no network request to retry. */
    },
  },
};
export const OlderPatch: Story = {
  args: {
    state: {
      status: "loaded",
      replay: {
        ...replayFixture,
        playback: {
          status: "incompatible",
          reason: "older_patch",
          latestPatch: "16.22",
        },
      },
    },
  },
};
export const MetadataPending: Story = {
  args: {
    state: {
      status: "loaded",
      replay: {
        ...replayFixture,
        gameBuild: null,
        protocol: null,
        durationSeconds: null,
        playback: { status: "metadata_pending" },
      },
    },
  },
};

/** Controlled UI fixture: old frames and seek completion are delivered separately. */
function ignoreFixtureSubscription(): void {
  // React owns the fixture's presentation updates.
}

function DelayedControlsFixture() {
  const [state, setState] = useState<ReplaySessionState>({
    timeSeconds: 52.7,
    durationSeconds: 120,
    playing: false,
    rate: 1,
    perspective: "all",
    camera: { mode: "free" },
    participants: [],
  });
  const snapshot = useRef(state);
  snapshot.current = state;
  const [requests, setRequests] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{
    time: number;
    resolve: () => void;
    reject: (reason: unknown) => void;
  } | null>(null);
  const active = useMemo<ReplaySession>(
    () => ({
      play() {
        setState((previous) => ({ ...previous, playing: true }));
      },
      pause() {
        setState((previous) => ({ ...previous, playing: false }));
      },
      seek(time) {
        pending.current?.reject(
          new DOMException("Replay seek superseded", "AbortError"),
        );
        setRequests((previous) => [...previous, time]);
        return new Promise<void>((resolve, reject) => {
          pending.current = { time, resolve, reject };
        });
      },
      setRate(rate) {
        setState((previous) => ({ ...previous, rate }));
      },
      setCamera(camera) {
        setState((previous) => ({ ...previous, camera }));
      },
      focusParticipant() {
        setState((previous) => ({ ...previous, camera: { mode: "free" } }));
      },
      setPerspective(perspective) {
        setState((previous) => ({ ...previous, perspective }));
      },
      resize() {
        /* The fixture has no game viewport. */
      },
      dispose() {
        pending.current?.reject(
          new DOMException("Fixture closed", "AbortError"),
        );
        pending.current = null;
      },
      getState: () => snapshot.current,
      subscribe(listener) {
        listener(snapshot.current);
        return ignoreFixtureSubscription;
      },
      subscribeErrors() {
        return ignoreFixtureSubscription;
      },
    }),
    [],
  );
  useEffect(
    () => () => {
      active.dispose();
    },
    [active],
  );
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">
        Replay controls interaction fixture
      </h1>
      <ReplayControls
        state={state}
        onCommand={(action) =>
          runReplayCommand(
            () => active,
            action,
            (failure) => {
              setError(
                failure instanceof Error ? failure.message : "Command failed",
              );
            },
          )
        }
      />
      <div className="flex gap-3">
        <Button
          onClick={() => {
            setState((previous) => ({ ...previous, timeSeconds: 52.7 }));
          }}
        >
          Present older frame
        </Button>
        <Button
          onClick={() => {
            const latest = pending.current;
            if (latest === null) return;
            pending.current = null;
            setState((previous) => ({ ...previous, timeSeconds: latest.time }));
            latest.resolve();
          }}
        >
          Complete latest seek
        </Button>
      </div>
      <output aria-label="Seek requests">{requests.join(", ")}</output>
      {error !== null && <p role="alert">{error}</p>}
    </div>
  );
}

export const DelayedSeekControls: Story = {
  render: () => <DelayedControlsFixture />,
};

function RuntimeFailureFixture() {
  const currentFailure = useRef<ReplayErrorListener | null>(null);
  const firstFailure = useRef<ReplayErrorListener | null>(null);
  const [disposals, setDisposals] = useState(0);
  const failResize = useRef(false);
  const failPlay = useRef(false);
  const [narrow, setNarrow] = useState(false);
  const initialize = useCallback(() => {
    let disposed = false;
    let failDispose = false;
    const state: ReplaySessionState = {
      timeSeconds: 10,
      durationSeconds: 120,
      playing: false,
      rate: 1,
      perspective: "all",
      camera: { mode: "free" },
      participants: [],
    };
    const active: ReplaySession = {
      play() {
        if (!failPlay.current) return;
        failPlay.current = false;
        failDispose = true;
        throw new Error("Replay play command failed");
      },
      pause: ignoreFixtureSubscription,
      seek(time) {
        state.timeSeconds = time;
        return Promise.resolve();
      },
      setRate: ignoreFixtureSubscription,
      setCamera: ignoreFixtureSubscription,
      focusParticipant: ignoreFixtureSubscription,
      setPerspective: ignoreFixtureSubscription,
      resize() {
        if (failResize.current) {
          failResize.current = false;
          throw new Error("Replay renderer resize failed");
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        setDisposals((previous) => previous + 1);
        if (failDispose) throw new Error("Replay disposal failed");
      },
      getState: () => state,
      subscribe(listener) {
        listener(state);
        return ignoreFixtureSubscription;
      },
      subscribeErrors(listener) {
        currentFailure.current = listener;
        firstFailure.current ??= listener;
        return () => {
          if (currentFailure.current === listener)
            currentFailure.current = null;
        };
      },
    };
    return Promise.resolve(active);
  }, []);
  return (
    <div className="space-y-4 p-6">
      <div style={{ width: narrow ? "50%" : "100%" }}>
        <ReplaySessionPlayer initialize={initialize} />
      </div>
      <Button
        onClick={() => {
          failResize.current = true;
          setNarrow((previous) => !previous);
        }}
      >
        Fail active replay on resize
      </Button>
      <Button
        onClick={() => {
          failPlay.current = true;
        }}
      >
        Fail next play and disposal
      </Button>
      <Button
        onClick={() => {
          currentFailure.current?.(
            new ReplayRuntimeError(new Error("Replay worker stopped")),
          );
        }}
      >
        Fail active replay
      </Button>
      <Button
        onClick={() => {
          firstFailure.current?.(
            new ReplayRuntimeError(new Error("Retired replay failed late")),
          );
        }}
      >
        Fail retired replay
      </Button>
      <output aria-label="Disposed sessions">{disposals}</output>
    </div>
  );
}

export const RuntimeFailureRecovery: Story = {
  render: () => <RuntimeFailureFixture />,
};
