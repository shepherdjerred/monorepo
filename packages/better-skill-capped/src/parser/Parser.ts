import { Content } from "../model/Content";
import { ManifestCommentary, ManifestCourse, ManifestCourseChapters, Manifest, ManifestVideo } from "./Manifest";
import { Video } from "../model/Video";
import { Course } from "../model/Course";
import { Commentary } from "../model/Commentary";
import { roleFromString } from "../model/Role";
import { rawTitleToDisplayTitle } from "../utils/TitleUtilities";
import { getCommentaryUrl, getVideoUrl } from "../utils/UrlUtilities";
import { CourseVideo } from "../model/CourseVideo";

export class Parser {
  parse(manifest: Manifest): Content {
    return {
      videos: this.parseVideos(manifest.videos, manifest.courses, manifest.videosToCourses),
      courses: this.parseCourses(manifest.videos, manifest.courses, manifest.videosToCourses),
      commentaries: this.parseCommentaries(manifest.commentaries),
      unmappedVideos: this.getUnmatchedVideos(manifest.videos, manifest.courses, manifest.videosToCourses),
    };
  }

  parseDate(input: number): Date {
    const releaseDate = new Date(0);
    releaseDate.setUTCMilliseconds(input);
    return releaseDate;
  }

  getUnmatchedVideos(input: ManifestVideo[], courses: ManifestCourse[], chapters: ManifestCourseChapters): Video[] {
    return input.flatMap((video) => {
      const match = this.matchVideoToCourse(video, courses, chapters);

      if (match !== undefined) {
        return [];
      } else {
        return {
          ...video,
        } as unknown as Video;
      }
    });
  }

  matchVideoToCourse(
    video: ManifestVideo,
    courses: ManifestCourse[],
    chapters: ManifestCourseChapters,
  ): { video: string; course: ManifestCourse } | undefined {
    let courseTitle: string | null = null;
    for (const [key, value] of Object.entries(chapters)) {
      if (value === undefined) {
        continue;
      }
      const match =
        value.chapters[0].vids.find((courseVideo) => {
          return courseVideo.uuid === video.uuid;
        }) !== undefined;
      if (match) {
        courseTitle = key;
        break;
      }
    }

    if (courseTitle === null) {
      return undefined;
    }

    const matchedCourse = courses.find((candidate) => {
      return courseTitle === candidate.title;
    });

    if (matchedCourse === undefined) {
      return undefined;
    }

    return {
      video: video.uuid,
      course: matchedCourse,
    };
  }

  parseVideos(input: ManifestVideo[], courses: ManifestCourse[], chapters: ManifestCourseChapters): Video[] {
    return input.flatMap((video: ManifestVideo): Video | Video[] => {
      const releaseDate = this.parseDate(video.rDate);
      const role = roleFromString(video.role);
      const imageUrl = this.getImageUrl(video);
      const title = rawTitleToDisplayTitle(video.title);

      const match = this.matchVideoToCourse(video, courses, chapters);

      if (match === undefined) {
        return [];
      }

      const fakeVideo = {
        title: video.title,
        uuid: video.uuid,
      } as Video;

      const videoUrl = getVideoUrl(fakeVideo);

      return {
        role,
        title,
        description: video.desc,
        releaseDate,
        durationInSeconds: video.durSec,
        uuid: video.uuid,
        imageUrl,
        skillCappedUrl: videoUrl,
      };
    });
  }

  getImageUrl(input: ManifestVideo | ManifestCommentary): string {
    if (input.tSS !== "") {
      return input.tSS.replace(
        "https://d20k8dfo6rtj2t.cloudfront.net/jpg-images/",
        "https://ik.imagekit.io/skillcapped/customss/jpg-images/",
      );
    } else {
      return `https://ik.imagekit.io/skillcapped/thumbnails/${input.uuid}/thumbnails/thumbnail_${String(input.tId)}.jpg`;
    }
  }

  parseCourses(
    manifestVideos: ManifestVideo[],
    manifestCourses: ManifestCourse[],
    manifestCourseChapters: ManifestCourseChapters,
  ): Course[] {
    const videos = this.parseVideos(manifestVideos, manifestCourses, manifestCourseChapters);

    return manifestCourses
      .filter((course) => manifestCourseChapters[course.title]?.chapters !== undefined)
      .map((course: ManifestCourse): Course => {
        const releaseDate = this.parseDate(course.rDate);
        const role = roleFromString(course.role);
        const title = rawTitleToDisplayTitle(course.title);

        const courseChapters = manifestCourseChapters[course.title];
        if (courseChapters === undefined) {
          throw new Error(`Course chapters not found for ${course.title}`);
        }
        const courseVideos: CourseVideo[] = courseChapters.chapters[0].vids.map((video) => {
          const videoInfo = videos.find((candidate) => candidate.uuid === video.uuid);
          const altTitle = video.altTitle !== undefined ? rawTitleToDisplayTitle(video.altTitle) : undefined;

          if (videoInfo === undefined) {
            throw new Error(`Couldn't find video ${JSON.stringify(video)}`);
          }

          return {
            video: videoInfo,
            altTitle,
          };
        });

        return {
          title,
          uuid: course.uuid,
          description: course.desc || undefined,
          releaseDate: releaseDate,
          role: role,
          image: course.courseImage2,
          videos: courseVideos,
        };
      });
  }

  parseCommentaries(dumpCommentary: ManifestCommentary[]): Commentary[] {
    return dumpCommentary
      .filter((commentary): commentary is ManifestCommentary & { title: string } => commentary.title !== undefined)
      .map((commentary): Commentary => {
        const releaseDate = this.parseDate(commentary.rDate);
        const role = roleFromString(commentary.role);
        const imageUrl = this.getImageUrl(commentary);
        const title = rawTitleToDisplayTitle(commentary.title);

        const fakeCommentary = {
          title: commentary.title,
          uuid: commentary.uuid,
        } as Commentary;

        const commentaryUrl = getCommentaryUrl(fakeCommentary);

        return {
          role,
          title,
          description: commentary.desc || "",
          releaseDate,
          durationInSeconds: commentary.durSec,
          uuid: commentary.uuid,
          imageUrl,
          skillCappedUrl: commentaryUrl,
          staff: commentary.staff,
          matchLink: commentary.matchLink,
          champion: commentary.yourChampion,
          opponent: commentary.theirChampion,
          kills: commentary.k,
          deaths: commentary.d,
          assists: commentary.a,
          gameLengthInMinutes: Number.parseInt(commentary.gameTime),
          carry: commentary.carry,
          type: commentary.type,
        };
      });
  }
}
