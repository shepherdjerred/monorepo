import { ArtifactPathSchema } from "@shepherdjerred/artifacts/contract";
import type { DocState } from "#client/lib/geometry.ts";
import type { FrameMessage } from "./bridge-protocol.ts";

/**
 * The artifact path a frame's `location` is at: its pathname minus the
 * content prefix (`/_t/<token>/`), without query or hash. A location outside
 * the prefix, or one that is not a valid artifact path, is the entry.
 */
export function artifactPathOf(
  location: string,
  prefixPathname: string,
  entryPath: string,
): string {
  const pathname = location.split(/[?#]/u)[0] ?? "";
  if (!pathname.startsWith(prefixPathname)) return entryPath;
  let rest = pathname.slice(prefixPathname.length);
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return entryPath;
  }
  return ArtifactPathSchema.safeParse(rest).success ? rest : entryPath;
}

/**
 * What the frame's document looks like after a bridge message, or null when
 * the message says nothing about the document (`key`, `point`, `error`, ...).
 * `drawn` sets the size, `scroll` the offset (and the size when it carries
 * one), `nav` the path.
 */
export function nextDocState(
  current: DocState | null,
  message: FrameMessage,
  context: { readonly entryPath: string; readonly prefixPathname: string },
): DocState | null {
  const base: DocState = current ?? {
    scrollX: 0,
    scrollY: 0,
    width: 0,
    height: 0,
    path: context.entryPath,
  };
  if (message.t === "drawn")
    return { ...base, width: message.docW, height: message.docH };
  if (message.t === "scroll")
    return {
      ...base,
      scrollX: message.x,
      scrollY: message.y,
      width: message.docW ?? base.width,
      height: message.docH ?? base.height,
    };
  if (message.t === "nav")
    return {
      ...base,
      path: artifactPathOf(
        message.path,
        context.prefixPathname,
        context.entryPath,
      ),
    };
  return null;
}
