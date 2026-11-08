import { serveReview } from "./review.ts";
export async function reviewScene(directory: string): Promise<void> {
  const server = await serveReview(directory);
  process.stdout.write(`${server.url.href}\n`);
  const { promise, resolve } = Promise.withResolvers<undefined>();
  const stop = () => {
    resolve(undefined);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await promise;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await server.stop(true);
  }
}
