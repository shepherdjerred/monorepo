import type { Breadcrumb } from "@sentry/bun";

/** BlueBubbles authenticates with query parameters; HTTP breadcrumbs must not retain them. */
export function sanitizeHttpCredentialBreadcrumb(
  breadcrumb: Breadcrumb,
): Breadcrumb {
  const rawUrl: unknown = breadcrumb.data?.["url"];
  if (typeof rawUrl !== "string") return breadcrumb;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return breadcrumb;
  }
  if (!["password", "token", "guid"].some((key) => url.searchParams.has(key)))
    return breadcrumb;
  url.search = "";
  return { ...breadcrumb, data: { ...breadcrumb.data, url: url.toString() } };
}
