import {
  isValorantCommentaryCourse,
  isWorldOfWarcraftCommentaryCourse,
} from "../course/commentaryFilters";
import Site from "../site";
import { doVideosMatch } from "../video/newVideoFinder";
import {
  RawChapters,
  RawCourse,
  RawLeagueOfLegendsSchema,
  RawSchemas,
  RawValorantSchema,
  RawVideo,
  RawWorldOfWarcraftSchema,
} from "./rawSchema";
import {
  LeagueOfLegendsSchema,
  Schemas,
  ValorantSchema,
  Video,
  WorldOfWarcraftSchema,
  Course,
} from "./schema";
import {
  getCommentaryUrl,
  getCourseUrl,
  getImageUrl,
  getVideoUrl,
} from "./urlUtilities";

export function getCourseName<T extends RawVideo | Video>(
  video: T,
  chapters: RawChapters
): string | undefined {
  for (const [key, value] of Object.entries(chapters)) {
    const match = value.chapters.find((chapter) => {
      return (
        chapter.vids.find((courseVideo) => {
          return courseVideo.uuid === video.uuid;
        }) !== undefined
      );
    });
    if (match) {
      return key;
    }
  }
  return undefined;
}

export function getRawVideoUrl(
  site: Site,
  video: RawVideo,
  courses: RawCourse[],
  chapters: RawChapters
) {
  const courseName = getCourseName(video, chapters);
  const course = courses.find((course) => course.title === courseName);
  if (!course) {
    console.error(`Could not find course for video ${JSON.stringify(video)}`);
    return undefined;
  }
  const courseUrl = getCourseUrl(site, course.title, course.uuid);
  const videoUrl = getVideoUrl(site, video.title, video.uuid, courseUrl);
  return videoUrl;
}

export function addMatchingVideosToCourse(
  associations: [Video, string][],
  course: Course
): Course {
  const courseVideos = associations
    .filter(([_, courseName]) => {
      return courseName === course.title;
    })
    .map(([video, _]) => video);
  return {
    ...course,
    videos: courseVideos,
  };
}

export function parseCourse(
  raw: RawCourse,
  associations: [Video, string][]
): Course {
  const courseWithoutVideos = {
    uuid: raw.uuid,
    title: raw.title,
    videos: [],
  };
  return addMatchingVideosToCourse(associations, courseWithoutVideos);
}

export function mapVideoToCourseName<T extends RawVideo | Video>(
  video: T,
  chapters: RawChapters
): [T, string | undefined] {
  const courseName = getCourseName(video, chapters);
  return [video, courseName];
}

export function mapVideosToCourseName<T extends RawVideo | Video>(
  videos: T[],
  chapters: RawChapters
) {
  return videos
    .map((video) => {
      return mapVideoToCourseName(video, chapters);
    })
    .filter((_, course) => {
      return course !== undefined;
    }) as [T, string][];
}

export function parseVideo(
  raw: RawVideo,
  site: Site,
  courses: RawCourse[],
  chapters: RawChapters
): Video | undefined {
  const partialVideo = {
    uuid: raw.uuid,
    title: raw.title,
    releaseDate: new Date(raw.rDate),
    url: "",
    thumbnail: "",
  };

  const videoUrl = getRawVideoUrl(site, raw, courses, chapters);
  if (!videoUrl) {
    return undefined;
  }

  return {
    ...partialVideo,
    url: videoUrl,
    thumbnail: getImageUrl(raw),
  };
}

export function parseCommentary(raw: RawVideo, site: Site) {
  const partialVideo = {
    uuid: raw.uuid,
    title: raw.title,
    releaseDate: new Date(raw.rDate),
    url: "",
    thumbnail: "",
  };

  const videoUrl = getCommentaryUrl(site, partialVideo.uuid);

  return {
    ...partialVideo,
    url: videoUrl,
    thumbnail: getImageUrl(raw),
  };
}

export function parseWorldOfWarcraft(
  raw: RawWorldOfWarcraftSchema
): WorldOfWarcraftSchema {
  const videos = raw.videos
    .filter((video) => {
      if (new Date(video.rDate).getFullYear() >= 2022) {
        return true;
      } else {
        return false;
      }
    })
    .map((video) =>
      parseVideo(
        video,
        Site.WORLD_OF_WARCRAFT,
        raw.courses,
        raw.videosToCourses
      )
    )
    .filter((video) => video !== undefined) as Video[];
  const associations = mapVideosToCourseName(videos, raw.videosToCourses);
  const courses = raw.courses.map((course) => {
    return parseCourse(course, associations);
  });
  const commentaryVideos = courses
    .filter(isWorldOfWarcraftCommentaryCourse)
    .map((course) => {
      return course.videos;
    })
    .flat();
  const nonCommentaryVideos = videos.filter((video) => {
    return !commentaryVideos.some((commentary) =>
      doVideosMatch(video, commentary)
    );
  });
  return {
    videos: nonCommentaryVideos,
    commentaries: commentaryVideos,
    courses,
  };
}

export function parseValorant(raw: RawValorantSchema): ValorantSchema {
  const videos = raw.videos
    .filter((video) => {
      if (new Date(video.rDate).getFullYear() >= 2022) {
        return true;
      } else {
        return false;
      }
    })
    .map((video) =>
      parseVideo(video, Site.VALORANT, raw.courses, raw.videosToCourses)
    )
    .filter((video) => video !== undefined) as Video[];
  const associations = mapVideosToCourseName(videos, raw.videosToCourses);
  const courses = raw.courses.map((course) => {
    return parseCourse(course, associations);
  });
  const commentaryVideos = courses
    .filter(isValorantCommentaryCourse)
    .map((course) => {
      return course.videos;
    })
    .flat();
  const nonCommentaryVideos = videos.filter((video) => {
    return !commentaryVideos.some((commentary) =>
      doVideosMatch(video, commentary)
    );
  });
  return {
    videos: nonCommentaryVideos,
    commentaries: commentaryVideos,
    courses,
  };
}

export function parseLeagueOfLegends(
  raw: RawLeagueOfLegendsSchema
): LeagueOfLegendsSchema {
  const videos = raw.videos
    .filter((video) => {
      if (new Date(video.rDate).getFullYear() >= 2022) {
        return true;
      } else {
        return false;
      }
    })
    .map((video) =>
      parseVideo(
        video,
        Site.LEAGUE_OF_LEGENDS,
        raw.courses,
        raw.videosToCourses
      )
    )
    .filter((video) => video !== undefined) as Video[];
  const associations = mapVideosToCourseName(videos, raw.videosToCourses);
  return {
    videos,
    commentaries: raw.commentaries.map((commentary) =>
      parseCommentary(commentary, Site.LEAGUE_OF_LEGENDS)
    ),
    courses: raw.courses.map((course) => {
      return parseCourse(course, associations);
    }),
  };
}

export function parse(site: Site, raw: RawSchemas): Schemas {
  switch (site) {
    case Site.LEAGUE_OF_LEGENDS:
      return parseLeagueOfLegends(raw as RawLeagueOfLegendsSchema);
    case Site.WORLD_OF_WARCRAFT:
      return parseWorldOfWarcraft(raw);
    case Site.VALORANT:
      return parseValorant(raw);
    default:
      throw Error("Unknown site");
  }
}
