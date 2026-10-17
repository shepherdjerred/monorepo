import path from "node:path";
import type { FileContext } from "#automation/files/types.ts";

export function storedFilePath(
  context: FileContext,
  kind: "movies" | "tv",
  root: "library" | "control" | "downloads",
  relative: string,
): string {
  return (
    context.pathMapping?.canonical(kind, root, relative) ??
    path.join(context.roots[kind][root], relative)
  );
}
export function workerFilePath(context: FileContext, stored: string): string {
  return context.pathMapping?.local(stored) ?? stored;
}
export function storedWorkerPath(
  context: FileContext,
  kind: "movies" | "tv",
  filename: string,
): string {
  for (const root of ["control", "library", "downloads"] as const) {
    const relative = path.relative(context.roots[kind][root], filename);
    if (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
      return storedFilePath(context, kind, root, relative);
  }
  throw new Error("Worker path escapes its declared media roots");
}
