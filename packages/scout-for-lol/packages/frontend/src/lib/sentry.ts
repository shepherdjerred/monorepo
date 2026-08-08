import * as Sentry from "@sentry/browser";

/** Initialize the frontend's Bugsink-backed Sentry client. */
export function initSentry(): void {
  // PUBLIC_SENTRY_RELEASE is injected at build time by the CI site-deploy
  // step (2.0.0-<build>). Guard the untyped env access so `release` stays
  // `string | undefined`, never `any`.
  const sentryRelease =
    typeof import.meta.env["PUBLIC_SENTRY_RELEASE"] === "string"
      ? import.meta.env["PUBLIC_SENTRY_RELEASE"]
      : undefined;
  Sentry.init({
    dsn: "https://337945d2208840dca4a573be311a1bbb@bugsink.sjer.red/1",
    release: sentryRelease,
    environment: import.meta.env.MODE,
    // Safari reports a blocked/failed third-party fetch as the generic
    // "TypeError: Load failed" with no useful frames, so it slips past the
    // beforeSend Pinterest matcher below — drop the frameless generic
    // network errors here. Our own code never surfaces these strings as
    // page errors: app fetches are handled (tRPC/react-query), and a
    // genuine app-side network failure is not actionable from Bugsink
    // anyway.
    ignoreErrors: [
      /^TypeError: Load failed$/,
      /^TypeError: Failed to fetch$/,
      /^TypeError: NetworkError when attempting to fetch resource\.$/,
    ],
    beforeSend(event) {
      // Drop third-party Pinterest conversion-tag fetch failures. The
      // tag's request to ct.pinterest.com fails whenever an ad-blocker or
      // privacy extension blocks it; that surfaces as
      // `TypeError: Failed to fetch (ct.pinterest.com)` originating from
      // s.pinimg.com. It is not actionable for us, so discard it.
      const fromPinterest = event.exception?.values?.some(
        (value) =>
          /pinterest/i.test(value.value ?? "") &&
          value.stacktrace?.frames?.some((frame) =>
            /pinimg\.com|pinterest/i.test(frame.filename ?? ""),
          ),
      );
      return fromPinterest === true ? null : event;
    },
  });
}
