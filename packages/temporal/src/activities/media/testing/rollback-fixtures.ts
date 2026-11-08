import { afterEach, beforeAll } from "vitest";
import { movieRollbackVideos } from "@shepherdjerred/media/testing/movie-rollback-workflow";

/** Each test file owns its generated video inputs and drains its own fixtures. */
export function useMovieRollbackVideos() {
  let videos: Awaited<ReturnType<typeof movieRollbackVideos>> | undefined;
  const closers: (() => Promise<void>)[] = [];
  beforeAll(async () => {
    videos = await movieRollbackVideos();
  });
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });
  return {
    videos() {
      if (videos === undefined)
        throw new Error("Rollback video inputs have not been initialized");
      return videos;
    },
    closeAfterTest(close: () => Promise<void>) {
      closers.push(close);
    },
  };
}
