import { z } from "zod";
import { useMatches, useParams } from "react-router";

const ViewSchema = z.enum([
  "home",
  "issues",
  "board",
  "project",
  "issue",
  "projects",
  "actors",
  "actor",
  "activity",
  "settings",
  "not-found",
]);
export type View = z.infer<typeof ViewSchema>;
const RouteHandleSchema = z.object({ view: ViewSchema });

/** Every route declares its view; the route tree uses this to build a handle. */
export function viewHandle(view: View) {
  return { view };
}

/** The matched leaf route, as the persistent layout needs to know it. */
export function useRoute() {
  const view = RouteHandleSchema.parse(useMatches().at(-1)?.handle).view;
  const params = useParams();
  return {
    view,
    isList: view === "issues" || view === "board" || view === "project",
    identifier: view === "issue" ? params["identifier"] : undefined,
    projectSlug: view === "project" ? params["slug"] : undefined,
    actorKey: view === "actor" ? params["key"] : undefined,
  };
}
export type RouteInfo = ReturnType<typeof useRoute>;

const HistoryStateSchema = z.object({ idx: z.number().int().positive() });
/** True when an earlier entry of this tab's history belongs to the app. */
export function hasAppHistory() {
  return HistoryStateSchema.safeParse(globalThis.history.state).success;
}

/** False for clicks the browser should keep, such as "open in new tab". */
export function isPlainClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
