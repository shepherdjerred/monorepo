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
  gameLengthInSeconds: number;
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
};

export type ContentItem = Video | Course | Commentary;

export type Content = {
  videos: Video[];
  courses: Course[];
  commentaries: Commentary[];
  unmappedVideos: Video[];
};
