import { useEffect } from "react";
import { useLocation } from "react-router";
import type { z } from "zod";
import type { MeSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { ApiFailure } from "@shepherdjerred/streambot/web/client/api.ts";
import type { Load } from "@shepherdjerred/streambot/web/client/use-load.ts";
import type { MediaItem } from "@shepherdjerred/streambot/web/client/media/row-model.ts";
import { startErrorReporting } from "./bugsink.ts";
import {
  errorShownEvent,
  pageViewEvent,
  playButton,
  resultChosenEvent,
  type FailureSurface,
  type PlayChoice,
} from "./events.ts";
import { capture, startAnalytics } from "./posthog.ts";

/**
 * Starts telemetry once `/api/me` answers — Bugsink when it carries `bugsink`, PostHog when it
 * carries an `analyticsId` — and records a page view per route pattern. Search text in `?q=` never counts:
 * typing a search changes the query, not the pathname.
 */
export function useTelemetry(me: Load<z.infer<typeof MeSchema>>): void {
  const { pathname } = useLocation();
  const data = me.status === "done" ? me.data : null;
  const bugsink = data?.bugsink ?? null;
  const analyticsId = data?.analyticsId ?? null;
  useEffect(() => {
    if (bugsink !== null) startErrorReporting(bugsink);
  }, [bugsink]);
  useEffect(() => {
    if (analyticsId === null) return;
    startAnalytics(analyticsId);
    capture(pageViewEvent(pathname, location.origin));
  }, [analyticsId, pathname]);
}

/** A row's play button or `⋯` menu item started a play. */
export function trackResultChosen(
  item: Pick<MediaItem, "kind" | "rank" | "actions">,
  fromMenu: boolean,
  choice: PlayChoice,
): void {
  capture(resultChosenEvent(item, playButton(fromMenu, choice)));
}

/**
 * Reports a failure once each time it is shown: on mount and whenever a different failure takes
 * its place, never on re-render. (`NO_VOICE` is one shared value, so identity alone cannot dedupe.)
 */
export function useErrorShown(
  failure: ApiFailure,
  surface: FailureSurface,
): void {
  useEffect(() => {
    capture(errorShownEvent(failure, surface));
  }, [failure, surface]);
}
