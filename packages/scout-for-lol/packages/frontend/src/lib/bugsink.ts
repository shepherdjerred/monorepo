import * as Sentry from "@sentry/browser";
import { bugsinkBrowserOptions } from "@shepherdjerred/bugsink-config";

/** Initialize the frontend's Bugsink client (Sentry SDK). */
export function initializeBugsink(): void {
  // PUBLIC_BUGSINK_RELEASE is the content-addressed site identity
  // (`scout-site@sha256:…`) that scripts/release/scout-site-release.ts injects
  // at build time; bugsinkBrowserOptions narrows the untyped value to
  // `string | undefined`.
  Sentry.init({
    ...bugsinkBrowserOptions({
      dsn: "https://337945d2208840dca4a573be311a1bbb@bugsink.sjer.red/1",
      environment: import.meta.env.MODE,
      release: import.meta.env["PUBLIC_BUGSINK_RELEASE"],
    }),
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
          ) === true,
      );
      return fromPinterest === true ? null : event;
    },
  });
}
