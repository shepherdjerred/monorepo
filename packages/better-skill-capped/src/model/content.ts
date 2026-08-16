import type { Role } from "./role.ts";

export const KINDS = ["video", "course", "commentary"] as const;

export type Kind = (typeof KINDS)[number];

type ItemBase = {
  uuid: string;
  title: string;
  releaseDate: Date;
  role: Role;
};

export type Video = ItemBase & {
  kind: "video";
  description: string;
  durationInSeconds: number;
  imageUrl: string;
  skillCappedUrl: string;
};

export type Commentary = ItemBase & {
  kind: "commentary";
  description: string;
  durationInSeconds: number;
  imageUrl: string;
  skillCappedUrl: string;
  staff: string;
  matchLink: string;
  champion: string;
  opponent: string;
  kills: number;
  deaths: number;
  assists: number;
  // Absent when the manifest's free-text `gameTime` is unreadable; see
  // `parseGameTime`. Modelled as missing rather than defaulted to 0 so the UI
  // omits the tag instead of claiming a 0m00s game.
  gameLengthInSeconds?: number | undefined;
  carry: string;
  type: string;
};

export type CourseVideo = {
  video: Video;
  alternateTitle?: string | undefined;
};

export type Course = ItemBase & {
  kind: "course";
  description?: string | undefined;
  image: string;
  videos: CourseVideo[];
  tags: string[];
  recommended: boolean;
  marketingString?: string | undefined;
  seasonString?: string | undefined;
};

export type ContentItem = Video | Course | Commentary;

export type Staff = {
  name: string;
  summonerName: string;
  profileImage: string;
  profileImageWithRank: string;
  playerPeakRank: number | string;
};

export type PatchInfo = {
  version: string;
  releaseDate: Date;
};

export type Content = {
  videos: Video[];
  courses: Course[];
  commentaries: Commentary[];
  unmappedVideos: Video[];
  staffByName: Map<string, Staff>;
  patch: PatchInfo;
  /** When the manifest snapshot itself was generated upstream. */
  generatedAt: Date;
};
