export type Manifest = {
  timestamp: number;
  patch: ManifestPatch;
  videos: ManifestVideo[];
  commentaries: ManifestCommentary[];
  staff: ManifestStaff[];
  courses: ManifestCourse[];
  thisWeekData: ManifestThisWeekData;
  videosToCourses: ManifestCourseChapters;
};

export type ManifestPatch = {
  patchVal: string;
  releaseDate: number;
  patchUrl: string;
};

export type ManifestVideo = {
  role: string;
  title: string;
  desc: string;
  rDate: number;
  durSec: number;
  uuid: string;
  tId: number;
  tSS: string;
  cSS: string;
};

export type ManifestCommentary = {
  role: string;
  title?: string;
  desc: string;
  rDate: number;
  durSec: number;
  uuid: string;
  tId: number;
  tSS: string;
  staff: string;
  matchLink: string;
  yourChampion: string;
  theirChampion: string;
  k: number;
  d: number;
  a: number;
  gameTime: string;
  carry: string;
  type: string;
};

export type ManifestStaff = {
  name: string;
  summonerName: string;
  profileImage: string;
  profileImageWithRank: string;
};

export type ManifestCourse = {
  title: string;
  uuid: string;
  desc: string;
  rDate: number;
  role: string;
  courseImage: string;
  courseImage2: string;
};

export type ManifestThisWeekData = {
  year: number;
  weekNum: number;
  release: number;
  role: string;
  type: string;
  vidTitle: string;
  order: number;
  courseName: string;
};

export type ManifestCourseChapters = Record<
  string,
  | {
      chapters: [
        {
          title: string;
          vids: [
            {
              uuid: string;
              altTitle?: string;
            },
          ];
        },
      ];
    }
  | undefined
>;
