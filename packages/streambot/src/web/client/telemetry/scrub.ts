import type { Breadcrumb, ErrorEvent } from "@sentry/react";
import { routePattern, sanitizeUrl } from "./privacy.ts";

/**
 * Browser error reports keep API paths and stack traces but never a query string: search text,
 * artwork sources and selection tokens all travel in queries. Page addresses (the event's URL,
 * navigation breadcrumbs) become route patterns, as in analytics. Pure functions, so the privacy
 * test can run them on fixture events.
 */

/** Removes the query string from every URL or path inside free text such as an error message. */
export function scrubText(text: string): string {
  return text.replaceAll(
    /([a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]*|\/[^\s?#"'<>]*)[?#][^\s"'<>]*/giu,
    "$1",
  );
}

function scrubData(
  data: Readonly<Record<string, unknown>>,
  navigation: boolean,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data)
      // Console breadcrumbs repeat their message as raw arguments.
      .filter(([key]) => key !== "arguments")
      .map(([key, value]) => {
        if (typeof value !== "string") return [key, value];
        return [key, navigation ? routePattern(value) : scrubText(value)];
      }),
  );
}

/**
 * Click and input breadcrumbs describe the element with its labels, which name titles; only their
 * category is kept. Navigation, fetch and console breadcrumbs lose their query strings.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const ui = breadcrumb.category?.startsWith("ui.") === true;
  const { message, data, ...rest } = breadcrumb;
  return {
    ...rest,
    ...(message === undefined || ui ? {} : { message: scrubText(message) }),
    ...(data === undefined
      ? {}
      : { data: scrubData(data, breadcrumb.category === "navigation") }),
  };
}

/** Scrubs an error event and tags it with the Reference of the last API response, when known. */
export function scrubErrorEvent(
  event: ErrorEvent,
  reference: string | null,
  siteOrigin: string,
): ErrorEvent {
  const { request } = event;
  return {
    ...event,
    ...(event.message === undefined
      ? {}
      : { message: scrubText(event.message) }),
    ...(request === undefined
      ? {}
      : {
          request: {
            ...(request.url === undefined
              ? {}
              : { url: sanitizeUrl(request.url, siteOrigin) }),
            ...(request.method === undefined ? {} : { method: request.method }),
          },
        }),
    ...(event.exception?.values === undefined
      ? {}
      : {
          exception: {
            ...event.exception,
            values: event.exception.values.map((value) => ({
              ...value,
              ...(value.value === undefined
                ? {}
                : { value: scrubText(value.value) }),
            })),
          },
        }),
    ...(event.breadcrumbs === undefined
      ? {}
      : {
          breadcrumbs: event.breadcrumbs.map((breadcrumb) =>
            scrubBreadcrumb(breadcrumb),
          ),
        }),
    ...(reference === null ? {} : { tags: { ...event.tags, reference } }),
  };
}
