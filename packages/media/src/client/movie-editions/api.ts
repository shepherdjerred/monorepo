import { queryClient } from "#client/api.ts";

export async function invalidateMovieRequests(mediaId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["movie-requests"] }),
    queryClient.invalidateQueries({ queryKey: ["movie-edition-context"] }),
    queryClient.invalidateQueries({ queryKey: ["requests"] }),
    queryClient.invalidateQueries({
      queryKey: mediaId === undefined ? ["media"] : ["media", mediaId],
    }),
    queryClient.invalidateQueries({ queryKey: ["target"] }),
    queryClient.invalidateQueries({ queryKey: ["movie-target"] }),
  ]);
}
