import { Video } from "../schema/schema";

// Finds any video that is present in the current list, but not in the previous list
export function filterNewVideos(current: Video[], previous: Video[]): Video[] {
  return current.filter((video: Video) => {
    return doesNoVideoMatch(video, previous);
  });
}

export function doesNoVideoMatch(target: Video, videos: Video[]): boolean {
  return !videos.some((candidate: Video) => {
    return doVideosMatch(target, candidate);
  });
}

export function doVideosMatch(left: Video, right: Video): boolean {
  return left.uuid === right.uuid;
}
