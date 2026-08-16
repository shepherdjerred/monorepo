import type {
  Content,
  Course,
  CourseVideo,
  Commentary,
  Video,
} from "#src/model/content";
import type {
  Manifest,
  ManifestCommentary,
  ManifestCourseChapters,
  ManifestVideo,
} from "./manifest.ts";
import { parseRole } from "#src/model/role";
import { rawTitleToDisplayTitle } from "#src/utils/title-utilities";
import { getCommentaryUrl, getVideoUrl } from "#src/utils/url-utilities";

export function parseManifest(manifest: Manifest): Content {
  const videoUuidToCourseTitle = buildVideoUuidToCourseTitle(
    manifest.videosToCourses,
  );
  const courseTitles = new Set(manifest.courses.map((course) => course.title));

  const parsedVideos = manifest.videos.map((video) => parseVideo(video));
  const videoByUuid = new Map(parsedVideos.map((video) => [video.uuid, video]));

  const videos: Video[] = [];
  const unmappedVideos: Video[] = [];
  for (const video of parsedVideos) {
    const courseTitle = videoUuidToCourseTitle.get(video.uuid);
    if (courseTitle !== undefined && courseTitles.has(courseTitle)) {
      videos.push(video);
    } else {
      unmappedVideos.push(video);
    }
  }

  return {
    videos,
    courses: parseCourses(manifest, videoByUuid),
    commentaries: manifest.commentaries.map((commentary) =>
      parseCommentary(commentary),
    ),
    unmappedVideos,
    staffByName: new Map(
      manifest.staff.map((staff) => [
        staff.name,
        {
          name: staff.name,
          summonerName: staff.summonerName,
          profileImage: staff.profileImage,
          profileImageWithRank: staff.profileImageWithRank,
          playerPeakRank: staff.playerPeakRank,
        },
      ]),
    ),
    patch: {
      version: manifest.patch.patchVal,
      releaseDate: parseDate(manifest.patch.releaseDate),
    },
    generatedAt: parseDate(manifest.timeStamp),
  };
}

function buildVideoUuidToCourseTitle(
  chapters: ManifestCourseChapters,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [courseTitle, entry] of Object.entries(chapters)) {
    if (entry === undefined) {
      continue;
    }
    for (const video of entry.chapters[0].vids) {
      if (!map.has(video.uuid)) {
        map.set(video.uuid, courseTitle);
      }
    }
  }
  return map;
}

export function parseDate(input: number): Date {
  const releaseDate = new Date(0);
  releaseDate.setUTCMilliseconds(input);
  return releaseDate;
}

/**
 * Game times arrive as "27m26s", but the production manifest also contains
 * typo'd variants ("23m35", "27m17m", "33m11ss", trailing spaces). Minutes
 * always lead; anything after the second number is upstream noise.
 *
 * `gameTime` is free text nobody validates upstream, and the variants above
 * are evidence that its spelling keeps drifting. An unrecognized value is
 * therefore expected boundary noise, not a broken caller contract, so this
 * returns `undefined` rather than throwing: a single unreadable commentary
 * loses its own game-length tag instead of aborting the entire content load.
 */
export function parseGameTime(input: string): number | undefined {
  const match = /^(\d+)m(?:(\d+)[a-z]*)?\s*$/.exec(input.trim());
  if (match === null) {
    return undefined;
  }
  const minutes = Number.parseInt(match[1] ?? "0", 10);
  const seconds = Number.parseInt(match[2] ?? "0", 10);
  return minutes * 60 + seconds;
}

export function getImageUrl(input: ManifestVideo | ManifestCommentary): string {
  return input.tSS === ""
    ? `https://ik.imagekit.io/skillcapped/thumbnails/${input.uuid}/thumbnails/thumbnail_${String(input.tId)}.jpg`
    : input.tSS.replace(
        "https://d20k8dfo6rtj2t.cloudfront.net/jpg-images/",
        "https://ik.imagekit.io/skillcapped/customss/jpg-images/",
      );
}

function parseVideo(video: ManifestVideo): Video {
  return {
    kind: "video",
    role: parseRole(video.role),
    title: rawTitleToDisplayTitle(video.title),
    description: video.desc,
    releaseDate: parseDate(video.rDate),
    durationInSeconds: video.durSec,
    uuid: video.uuid,
    imageUrl: getImageUrl(video),
    skillCappedUrl: getVideoUrl({ uuid: video.uuid }),
  };
}

function parseCourses(
  manifest: Manifest,
  videoByUuid: Map<string, Video>,
): Course[] {
  return manifest.courses.flatMap((course): Course[] => {
    const chapterEntry = manifest.videosToCourses[course.title];
    if (chapterEntry === undefined) {
      return [];
    }

    const courseVideos: CourseVideo[] = chapterEntry.chapters[0].vids.map(
      (video): CourseVideo => {
        const videoInfo = videoByUuid.get(video.uuid);
        if (videoInfo === undefined) {
          throw new Error(
            `Course "${course.title}" references unknown video ${JSON.stringify(video)}`,
          );
        }
        return {
          video: videoInfo,
          ...(video.altTitle === undefined
            ? {}
            : { alternateTitle: rawTitleToDisplayTitle(video.altTitle) }),
        };
      },
    );

    return [
      {
        kind: "course",
        title: rawTitleToDisplayTitle(course.title),
        uuid: course.uuid,
        ...(course.desc === "" ? {} : { description: course.desc }),
        releaseDate: parseDate(course.rDate),
        role: parseRole(course.role),
        image: course.courseImage2,
        videos: courseVideos,
        tags: course.tags,
        recommended: course.recommended,
        ...(course.marketingString === undefined
          ? {}
          : { marketingString: course.marketingString }),
        ...(course.seasonString === undefined
          ? {}
          : { seasonString: course.seasonString }),
      },
    ];
  });
}

// Production commentaries carry no `title` at all (verified Aug 2026: 0 of
// 3231). The old parser filtered on `title !== undefined`, which silently
// removed every commentary from the app. The card UI renders the matchup as
// the heading, so derive the title from it instead of filtering.
function parseCommentary(commentary: ManifestCommentary): Commentary {
  const gameLengthInSeconds = parseGameTime(commentary.gameTime);
  return {
    kind: "commentary",
    role: parseRole(commentary.role),
    title:
      commentary.title === undefined
        ? `${commentary.yourChampion} vs ${commentary.theirChampion}`
        : rawTitleToDisplayTitle(commentary.title),
    description: commentary.desc ?? "",
    releaseDate: parseDate(commentary.rDate),
    durationInSeconds: commentary.durSec,
    uuid: commentary.uuid,
    imageUrl: getImageUrl(commentary),
    skillCappedUrl: getCommentaryUrl({ uuid: commentary.uuid }),
    staff: commentary.staff,
    matchLink: commentary.matchLink,
    champion: commentary.yourChampion,
    opponent: commentary.theirChampion,
    kills: commentary.k,
    deaths: commentary.d,
    assists: commentary.a,
    ...(gameLengthInSeconds === undefined ? {} : { gameLengthInSeconds }),
    carry: commentary.carry,
    type: commentary.type,
  };
}
