import type { ErrorEvent, StackFrame } from "@sentry/react";

/**
 * Browser-extension URL schemes. Extension content scripts and background
 * pages execute in the app's JS realm, so their failures surface through
 * the app's global error handlers even though they are not app bugs.
 */
const EXTENSION_URL_SCHEMES = [
  "chrome-extension://",
  "moz-extension://",
  "safari-extension://",
  "safari-web-extension://",
];

function isExtensionFrame(frame: StackFrame | undefined): boolean {
  const filename = frame?.filename;
  return (
    filename !== undefined &&
    EXTENSION_URL_SCHEMES.some((scheme) => filename.startsWith(scheme))
  );
}

/**
 * Sentry `beforeSend` filter for the Scout web app.
 *
 * Drops events whose stack starts or ends in browser-extension code: the
 * newest frame (throw site) or the outermost frame running under an
 * extension means the failure is extension-entangled, not an app bug.
 * Extension frames in the middle of an otherwise app-owned stack (e.g. an
 * extension wrapping XHR) still report.
 */
export function filterScoutAppSentryEvent(
  event: ErrorEvent,
): ErrorEvent | null {
  const values = event.exception?.values ?? [];
  for (const value of values) {
    const frames = value.stacktrace?.frames ?? [];
    if (isExtensionFrame(frames.at(0)) || isExtensionFrame(frames.at(-1))) {
      return null;
    }
  }
  return event;
}
