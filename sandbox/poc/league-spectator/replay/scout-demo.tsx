import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { ScoutThemeProvider } from "@scout-for-lol/design-system/runtime";
import { createResearchReplaySession } from "@scout-for-lol/replay/research";
import { ReplaySessionPlayer } from "../../../../packages/scout-for-lol/packages/app/src/components/replay/replay-player.tsx";
import { loadVerifiedReplaySource } from "../../../../packages/scout-for-lol/packages/app/src/lib/replay/load-session.ts";
import type { ReplayPlaybackControlsProps } from "../../../../packages/scout-for-lol/packages/app/src/components/replay/replay-controls.tsx";
import { ScoutNativeReplayControls } from "./scout-native-replay-controls.tsx";

const DemoConfigSchema = z.strictObject({
  schema: z.literal(1),
  build: z.literal("16.21.829.8620"),
  protocol: z.literal("20e09df23c66b85e"),
  durationSeconds: z.number().positive(),
  decodedSeconds: z.number().positive(),
  assetBase: z.string(),
  staticRootSha256: z.string().regex(/^[0-9a-f]{64}$/),
  nativeControls: z
    .strictObject({
      url: z.literal("/demo/native-controls.json"),
      bytes: z
        .number()
        .int()
        .positive()
        .max(2 * 1024 * 1024),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .optional(),
  replay: z.strictObject({
    url: z.literal("/demo/replay.rofl"),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
});
type DemoConfig = z.infer<typeof DemoConfigSchema>;

type DemoDiagnosticEngine = {
  diagnostics: {
    startPerformanceRecording: () => Promise<unknown>;
    stopPerformanceRecording: () => unknown;
    renderResources: () => unknown;
  };
};
type DemoEngineModule = {
  createLatestViewerEngine: (options: unknown) => DemoDiagnosticEngine;
};
let demoGeneration = 0;
let demoPresentationSequence = 0;
function markDemoPresentation() {
  demoPresentationSequence += 1;
}
let diagnosticOwner: {
  generation: number;
  engine: WeakRef<DemoDiagnosticEngine>;
} | null = null;
let recordingOwner: WeakRef<DemoDiagnosticEngine> | null = null;
function diagnosticEngine() {
  const engine = diagnosticOwner?.engine.deref();
  if (!engine) throw new Error("No active local replay diagnostic owner");
  return engine;
}
function diagnosticAbort(generation: number) {
  return () => {
    if (diagnosticOwner?.generation === generation) diagnosticOwner = null;
  };
}
function ownDemoDiagnostics(engine: DemoDiagnosticEngine, signal: AbortSignal) {
  const generation = ++demoGeneration;
  diagnosticOwner = { generation, engine: new WeakRef(engine) };
  signal.addEventListener("abort", diagnosticAbort(generation), { once: true });
}
// Local harness only. Neither the window accessor nor an aborted load retains
// an engine, raw replay or resource graph after SDK disposal.
Object.defineProperty(window, "__scoutReplayResearch", {
  configurable: true,
  value: Object.freeze({
    async startPerformanceRecording() {
      if (recordingOwner)
        throw new Error("A local replay recording is already owned");
      const engine = diagnosticEngine();
      const contract = await engine.diagnostics.startPerformanceRecording();
      recordingOwner = new WeakRef(engine);
      return contract;
    },
    stopPerformanceRecording() {
      const engine = recordingOwner?.deref();
      recordingOwner = null;
      if (!engine) throw new Error("No retained local replay recording owner");
      return engine.diagnostics.stopPerformanceRecording();
    },
    renderResources() {
      return diagnosticEngine().diagnostics.renderResources();
    },
    presentations() {
      return demoPresentationSequence;
    },
    release() {
      diagnosticOwner = null;
      recordingOwner = null;
    },
  }),
});

function LoadedDemo(props: { config: DemoConfig }) {
  const nativeControls = props.config.nativeControls;
  const renderPlaybackControls = (input: ReplayPlaybackControlsProps) =>
    nativeControls === undefined ? null : (
      <ScoutNativeReplayControls
        state={input.state}
        supportedRates={input.controls.rates}
        resource={nativeControls}
        command={input.onCommand}
      />
    );
  const initialize = useCallback(
    async (canvas: HTMLCanvasElement, signal: AbortSignal) => {
      const replay = await loadVerifiedReplaySource(
        props.config.replay,
        signal,
      );
      return createResearchReplaySession({
        canvas,
        replay,
        signal,
        assetBase: new URL(props.config.assetBase, location.href).href,
        staticRootSha256: props.config.staticRootSha256,
        decodedSeconds: props.config.decodedSeconds,
        replayDurationSeconds: props.config.durationSeconds,
        onPreparation: (event) => {
          console.debug(`scout-replay-preparation:${JSON.stringify(event)}`);
        },
        loadEngine: async () => {
          const source = "/research/latest-viewer.mjs";
          const module = (await import(
            /* @vite-ignore */ source
          )) as DemoEngineModule;
          return {
            ...module,
            createLatestViewerEngine: (options: unknown) => {
              const engine = module.createLatestViewerEngine(options);
              ownDemoDiagnostics(engine, signal);
              return engine;
            },
          };
        },
      });
    },
    [props.config],
  );
  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-6 sm:px-8">
      <header className="space-y-2">
        <p className="text-sm font-medium text-scout-brand">
          Scout · Local research demo
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Browser replay
        </h1>
        <p className="text-sm text-scout-subtle">
          Build {props.config.build} · Howling Abyss ·{" "}
          {props.config.decodedSeconds === props.config.durationSeconds
            ? "Entire recorded match"
            : `First ${props.config.decodedSeconds.toString()} seconds`}
        </p>
        <p className="max-w-3xl text-sm leading-6 text-scout-subtle">
          Verified partial presentation using the real replay decoder and
          renderer inside Scout’s player. Audio, team vision, directed camera,
          and full native fidelity remain unavailable.
        </p>
      </header>
      <ReplaySessionPlayer
        initialize={initialize}
        search={location.search}
        onState={markDemoPresentation}
        controls={{
          rates: [0.5, 1, 2, 4],
          perspectives: ["all"],
          directedCamera: false,
        }}
        {...(nativeControls === undefined ? {} : { renderPlaybackControls })}
      />
    </main>
  );
}

function ScoutResearchDemo() {
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/demo/config.json", {
          credentials: "omit",
          signal: abort.signal,
        });
        if (!response.ok)
          throw new Error("The local replay demo could not be loaded.");
        const value: unknown = await response.json();
        const next = DemoConfigSchema.parse(value);
        if (!abort.signal.aborted) setConfig(next);
      } catch (error_) {
        if (!abort.signal.aborted)
          setError(
            error_ instanceof Error
              ? error_.message
              : "The local replay demo could not be loaded.",
          );
      }
    };
    void load();
    return () => {
      abort.abort();
    };
  }, []);
  return (
    <ScoutThemeProvider surface="app">
      {error !== null ? (
        <p role="alert" className="p-8">
          {error}
        </p>
      ) : config === null ? (
        <p role="status" className="p-8">
          Loading local replay demo…
        </p>
      ) : (
        <LoadedDemo config={config} />
      )}
    </ScoutThemeProvider>
  );
}

const container = document.getElementById("root");
if (container === null) throw new Error("Scout replay demo root is missing");
createRoot(container).render(<ScoutResearchDemo />);
