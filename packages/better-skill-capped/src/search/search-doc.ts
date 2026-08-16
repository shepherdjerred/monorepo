import type {
  Content,
  Course,
  Commentary,
  Kind,
  Video,
} from "#src/model/content";
import type { Role } from "#src/model/role";
import { auxiliaryTerms, normalizeName } from "./normalize.ts";

/**
 * The flattened, index-ready projection of a ContentItem. Searchable string
 * fields carry both display and normalized token forms; enum fields exist
 * for faceting and where-clauses. Consumers resolve `uuid` back to the full
 * ContentItem.
 */
export type SearchDoc = {
  id: string;
  uuid: string;
  kind: Kind;
  // Searchable strings
  title: string;
  description: string;
  childTitles: string;
  champions: string;
  staffText: string;
  searchAux: string;
  // Facet / filter fields
  role: Role;
  staff: string;
  yourChampion: string;
  theirChampion: string;
  tags: string[];
  carry: string;
  commentaryType: string;
  recommended: boolean;
  // Sortable numbers
  releaseDate: number;
  durationInSeconds: number;
};

function videoToDoc(video: Video): SearchDoc {
  return {
    id: `video:${video.uuid}`,
    uuid: video.uuid,
    kind: "video",
    title: video.title,
    description: video.description,
    childTitles: "",
    champions: "",
    staffText: "",
    searchAux: auxiliaryTerms(`${video.title} ${video.description}`),
    role: video.role,
    staff: "",
    yourChampion: "",
    theirChampion: "",
    tags: [],
    carry: "",
    commentaryType: "",
    recommended: false,
    releaseDate: video.releaseDate.getTime(),
    durationInSeconds: video.durationInSeconds,
  };
}

function courseToDoc(course: Course): SearchDoc {
  const childTitles = course.videos
    .map((courseVideo) => courseVideo.alternateTitle ?? courseVideo.video.title)
    .join(" ");
  return {
    id: `course:${course.uuid}`,
    uuid: course.uuid,
    kind: "course",
    title: course.title,
    description: course.description ?? "",
    childTitles,
    champions: "",
    staffText: "",
    searchAux: auxiliaryTerms(`${course.title} ${childTitles}`),
    role: course.role,
    staff: "",
    yourChampion: "",
    theirChampion: "",
    // Tags arrive with the parser enrichment phase; the field is already
    // indexed so wiring them is a one-line change in courseToDoc.
    tags: [],
    carry: "",
    commentaryType: "",
    recommended: false,
    releaseDate: course.releaseDate.getTime(),
    durationInSeconds: course.videos.reduce(
      (total, courseVideo) => total + courseVideo.video.durationInSeconds,
      0,
    ),
  };
}

function commentaryToDoc(commentary: Commentary): SearchDoc {
  const champions = [
    commentary.champion,
    normalizeName(commentary.champion),
    commentary.opponent,
    normalizeName(commentary.opponent),
  ].join(" ");
  return {
    id: `commentary:${commentary.uuid}`,
    uuid: commentary.uuid,
    kind: "commentary",
    title: commentary.title,
    description: commentary.description,
    childTitles: "",
    champions,
    staffText: commentary.staff,
    searchAux: auxiliaryTerms(commentary.title),
    role: commentary.role,
    staff: commentary.staff,
    yourChampion: commentary.champion,
    theirChampion: commentary.opponent,
    tags: [],
    carry: commentary.carry,
    commentaryType: commentary.type,
    recommended: false,
    releaseDate: commentary.releaseDate.getTime(),
    durationInSeconds: commentary.durationInSeconds,
  };
}

export function contentToSearchDocs(content: Content): SearchDoc[] {
  return [
    ...content.courses.map((course) => courseToDoc(course)),
    ...content.videos.map((video) => videoToDoc(video)),
    ...content.commentaries.map((commentary) => commentaryToDoc(commentary)),
  ];
}
