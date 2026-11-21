import type { CaptureResult, PostHogConfig } from "posthog-js";
import { ANALYTICS_SITE } from "@shepherdjerred/streambot/web/shared/analytics-site.ts";
import { replayAttribute, sanitizeRecord, sanitizeUrl } from "./privacy.ts";

/** Strip every query, fragment and concrete path from what PostHog records automatically. */
export function sanitizeCapture(
  result: CaptureResult | null,
  siteOrigin: string,
): CaptureResult | null {
  if (result === null) return null;
  return {
    ...result,
    properties: sanitizeRecord(result.properties, siteOrigin),
    ...(result.$set === undefined
      ? {}
      : { $set: sanitizeRecord(result.$set, siteOrigin) }),
    ...(result.$set_once === undefined
      ? {}
      : { $set_once: sanitizeRecord(result.$set_once, siteOrigin) }),
  };
}

/**
 * The PostHog configuration. Autocapture, rage clicks, dead clicks and heatmaps are all off:
 * autocapture records a clicked link's `href` (`attr__href` in `$elements_chain`) whatever the
 * attribute masking says, and the product events are the explicit ones in `events.ts`. What runs
 * is page views (captured by hand), page leave, web vitals and session replay. Replay masks every
 * text node and input and blanks every attribute that is not layout, because the remote renders
 * titles and Discord names as text and in `aria-label`s. Network timing is off (request URLs carry
 * search text). `before_send` rewrites every URL, absolute or relative, to a route pattern.
 */
export function analyticsConfig(
  analyticsId: string,
  siteOrigin: string,
): Partial<PostHogConfig> {
  return {
    api_host: ANALYTICS_SITE.proxyHost,
    asset_host: ANALYTICS_SITE.proxyHost,
    ui_host: "https://us.posthog.com",
    defaults: "2026-05-30",
    bootstrap: { distinctID: analyticsId, isIdentifiedID: true },
    // The identity is per host: a `.sjer.red` cookie would join this signed-in person to
    // anonymous visits of every other sjer.red site.
    cross_subdomain_cookie: false,
    autocapture: false,
    rageclick: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    // Page views are captured by hand with the route pattern; see `pageViewEvent`.
    capture_pageview: false,
    capture_pageleave: true,
    capture_performance: { web_vitals: true, network_timing: false },
    capture_exceptions: false,
    respect_dnt: true,
    person_profiles: "always",
    mask_all_text: true,
    mask_all_element_attributes: true,
    mask_personal_data_properties: true,
    save_campaign_params: false,
    save_referrer: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
      maskAttributeFn: replayAttribute,
      recordHeaders: false,
      recordBody: false,
      // Also applied to the page address replay records with each snapshot.
      maskCapturedNetworkRequestFn: (request) => ({
        ...request,
        name: sanitizeUrl(request.name, siteOrigin),
      }),
    },
    disable_session_recording: false,
    before_send: (result) => sanitizeCapture(result, siteOrigin),
  };
}
