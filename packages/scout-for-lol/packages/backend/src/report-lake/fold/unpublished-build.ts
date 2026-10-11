import { rm } from "node:fs/promises";

export async function withUnpublishedBuildCleanup<T>(
  buildDir: string,
  work: (markPublished: () => void) => Promise<T>,
): Promise<T> {
  const publication = { completed: false };
  try {
    return await work(() => {
      publication.completed = true;
    });
  } finally {
    if (!publication.completed)
      await rm(buildDir, { recursive: true, force: true });
  }
}
