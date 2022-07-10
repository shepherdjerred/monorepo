import Site from "../site";
import { RawCommentary, RawVideo } from "./rawSchema";

export function getBaseUrl(site: Site): string {
  switch (site) {
    case Site.LEAGUE_OF_LEGENDS:
      return "https://www.skill-capped.com/lol/";
    case Site.WORLD_OF_WARCRAFT:
      return "https://www.skill-capped.com/wow/";
    case Site.VALORANT:
      return "https://www.skill-capped.com/valorant/";
    default:
      throw Error("Unknown site");
  }
}

export function rawTitleToUrlTitle(rawTitle: string): string {
  return rawTitle
    .toLowerCase()
    .replace(/ /g, "-")
    .replace(/\$/g, "")
    .replace(/[!:.'%,[\]]/g, "");
}

export function getCourseUrl(
  site: Site,
  courseName: string,
  courseUuid: string
): string {
  const base = getBaseUrl(site);
  if (site === Site.LEAGUE_OF_LEGENDS) {
    return base + "browse2/" + courseUuid;
  } else {
    return base + "course/" + rawTitleToUrlTitle(courseName) + "/" + courseUuid;
  }
}

export function getVideoUrl(
  site: Site,
  videoName: string,
  videoUuid: string,
  baseUrl: string
): string {
  if (site === Site.LEAGUE_OF_LEGENDS) {
    return baseUrl + "/" + videoUuid;
  } else {
    return baseUrl + "/" + rawTitleToUrlTitle(videoName) + "/" + videoUuid;
  }
}

export function getCommentaryUrl(site: Site, commentartyUuid: string): string {
  const base = getBaseUrl(site);
  if (site === Site.LEAGUE_OF_LEGENDS) {
    return base + "commentaries/" + commentartyUuid;
  } else {
    throw Error("Only league of legends has a unique commentary URL");
  }
}

export function getImageUrl(input: RawVideo | RawCommentary): string {
  if (input.tSS !== "") {
    return input.tSS.replace(
      "https://d20k8dfo6rtj2t.cloudfront.net/jpg-images/",
      "https://ik.imagekit.io/skillcapped/customss/jpg-images/"
    );
  } else {
    return `https://ik.imagekit.io/skillcapped/thumbnails/${input.uuid}/thumbnails/thumbnail_${input.tId}.jpg`;
  }
}
