import type { ReplayRenderPackageManifest } from "@scout-for-lol/domain/artifacts/replay-support.ts";
import type { ReplaySession, ReplayStateListener } from "./types.ts";

/** Engine entrypoints and workers are self-contained build outputs. Resource
 * access goes through this owned, digest-checked inventory rather than globals. */
export type ReplayResources = {
  read: (path: string) => Promise<Uint8Array<ArrayBuffer>>;
  objectUrl: (path: string, mimeType?: string) => Promise<string>;
  moduleUrl: (path: string) => Promise<string>;
  worker: (path: string) => Promise<Worker>;
};
export type CreateReplayEngineOptions = {
  canvas: HTMLCanvasElement;
  replay: ArrayBuffer;
  manifest: ReplayRenderPackageManifest;
  resources: ReplayResources;
  signal: AbortSignal;
  onState: ReplayStateListener;
  onError: (cause: unknown) => void;
};
export type ReplayEngineSession = Omit<ReplaySession, "subscribeErrors"> & {
  /** Resolves only after the replay world has actually been presented. */
  firstFrame: Promise<void>;
};
export type ReplayEngineFactory = (
  options: CreateReplayEngineOptions,
) => Promise<ReplayEngineSession>;
