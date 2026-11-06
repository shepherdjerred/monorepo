import type { NativeSubtitleSnapshot } from "#shared/native-subtitles.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { terminalRebindingChain } from "#infrastructure/native-recovery/terminal-rebinding.ts";

export type InstalledSubtitleInput = {
  subtitle: NativeSubtitleSnapshot;
  chain: Awaited<ReturnType<typeof terminalRebindingChain>>;
  video: {
    path: string;
    checksum: string;
    mediaIds: string[];
    libraryKind: "movies" | "tv";
  };
  videoBindings: { version: number; epoch: number }[];
  movieScope?: MovieEditionScope;
};
