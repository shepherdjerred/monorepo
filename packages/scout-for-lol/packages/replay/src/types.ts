export type ReplayPerspective = "all" | "blue" | "red";
export type ReplayPresentationCapabilities = Readonly<{
  perspectives: readonly ReplayPerspective[];
  directedCamera: boolean;
  rates?: readonly number[];
  announcerPreview?: "female1-en-us";
  particlePreview?: "verified-partial-effects";
  minimapUrl?: string;
  unitVisibility?: true;
  timelineEvents?: readonly Readonly<{
    timeSeconds: number;
    label: string;
    kind?: "elimination";
    mapPoint?: ReplayMapPoint;
  }>[];
}>;
export type ReplayMapPoint = readonly [horizontal: number, vertical: number];
export type ReplayMapActor = Readonly<{
  id: number;
  kind: "champion" | "minion";
  teamId: 100 | 200;
  point: ReplayMapPoint;
}>;
export type ReplayCamera = {
  mode: "free" | "directed" | "follow";
  participantId?: number;
};
export type ReplayParticipant = {
  participantId: number;
  name: string;
  championName: string;
  teamId: 100 | 200;
};
export type ReplayPlayerScore = Readonly<{
  participantId: number;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  level: number | null;
  alive?: boolean | null;
  health?: Readonly<{ current: number; max: number }>;
  gold?: number;
  resource?: Readonly<{ current: number; max: number }>;
  experience?: Readonly<{
    total: number;
    progress?: Readonly<{ current: number; max: number }>;
  }>;
  inventory?: readonly (ReplayInventoryItem | null)[];
}>;
export type ReplayInventoryItem = Readonly<{
  itemId: number;
  count: number;
  name: string;
  iconUrl: string;
  width: number;
  height: number;
}>;
export type ReplayScoreboard = Readonly<{
  blueKills: number | null;
  redKills: number | null;
  winningTeam: 100 | 200 | null;
  players: readonly ReplayPlayerScore[];
}>;
export type ReplaySessionState = {
  timeSeconds: number;
  durationSeconds: number;
  playing: boolean;
  rate: number;
  perspective: ReplayPerspective;
  camera: ReplayCamera;
  participants: ReplayParticipant[];
  scoreboard?: ReplayScoreboard;
  mapActors?: readonly ReplayMapActor[];
  cameraView?: {
    mapPoint: ReplayMapPoint;
    zoomStep: number;
    maxZoomStep: number;
  };
};
export type ReplayStateListener = (state: ReplaySessionState) => void;
export class ReplayRuntimeError extends Error {
  override readonly name = "ReplayRuntimeError";
  readonly code = "engine-failed";
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}
export type ReplayErrorListener = (error: ReplayRuntimeError) => void;
export type ReplayPreparationEvent = {
  source: string;
  stage: string;
  phase: "begin" | "end";
  elapsedMs: number;
  atEpochMs: number;
  counts: Record<string, number>;
};
export type ReplayPreparationListener = (event: ReplayPreparationEvent) => void;
export type ReplaySession = {
  /** Omitted by engines that use the standard spectator controls. */
  capabilities?: ReplayPresentationCapabilities;
  play: () => void;
  pause: () => void;
  seek: (timeSeconds: number) => Promise<void>;
  setRate: (rate: number) => void;
  /** Opt-in preview for the explicit announcer profile advertised by the engine. */
  setAnnouncerPreview?: (enabled: boolean) => Promise<void>;
  /** Select and center once without locking the camera to the participant. */
  focusParticipant: (participantId: number) => void;
  setCamera: (camera: ReplayCamera) => void;
  /** Drag the free view by a displacement in CSS pixels. Setting free mode resets it. */
  panCamera?: (deltaX: number, deltaY: number) => void;
  /** Select a free camera target in normalized minimap coordinates. */
  moveCameraToMap?: (point: ReplayMapPoint) => void;
  adjustCameraZoom?: (direction: -1 | 1) => void;
  setPerspective: (perspective: ReplayPerspective) => void;
  resize: (width?: number, height?: number, devicePixelRatio?: number) => void;
  dispose: () => void;
  getState: () => ReplaySessionState;
  subscribe: (listener: ReplayStateListener) => () => void;
  /** Reports the first fatal engine failure, including one before subscription. */
  subscribeErrors: (listener: ReplayErrorListener) => () => void;
};
export type CreateReplaySessionOptions = {
  canvas: HTMLCanvasElement;
  replay: ArrayBuffer;
  manifestUrl: string;
  manifestSha256: string;
  signal?: AbortSignal;
  onState?: ReplayStateListener;
};
export class ReplayCapabilityError extends Error {
  override readonly name = "ReplayCapabilityError";
  constructor(
    readonly code:
      | "invalid-package"
      | "incompatible-build"
      | "unsupported-capability"
      | "engine-unavailable",
    message: string,
  ) {
    super(message);
  }
}
