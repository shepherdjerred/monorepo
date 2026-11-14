/** Stable, non-sensitive identity retained across queueing and process recovery. */
export type SportsPlaybackRecipe = {
  readonly sourceUrl: string;
  readonly serverId?: string;
};

/** Concrete media inputs owned by one preparation/playback attempt. Never persist this object. */
export type PreparedSportsInput = {
  readonly title: string;
  readonly input: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly inputOptions?: readonly string[];
  readonly audioInput?: string;
  readonly audioInputHeaders?: Readonly<Record<string, string>>;
  readonly audioInputOptions?: readonly string[];
  readonly videoStreamIndex?: number;
  readonly audioStreamIndex?: number;
  readonly hdr?: boolean;
  /** Provider-side failure, independent of the ffmpeg subprocess consuming the relay. */
  readonly failure?: Promise<never>;
  readonly close: () => Promise<void>;
};

export type PrepareSportsInput = (
  recipe: SportsPlaybackRecipe,
  signal: AbortSignal,
) => Promise<PreparedSportsInput>;
