import type { PageDetails } from "./types.js";

// Astro CSS parsing fails: Error: Could not parse CSS stylesheet
// Remove CSS from the HTML
// https://github.com/jsdom/jsdom/issues/2005#issuecomment-1758940894
export function sanitizeHtml(html: string): string {
  return html
    .replaceAll(/<style[^>]*>[^<]*<\/style>/gi, "")
    .replaceAll(/<script[^>]*>[^<]*<\/script>/gi, "");
}

function getMetaContent(document: Document, property: string): string | null {
  const content = document.querySelector(`meta[property='${property}']`)?.getAttribute("content");
  if (content === undefined || content === null || content === "") {
    return null;
  }
  return content;
}

export function extract(document: Document): PageDetails {
  const title = getMetaContent(document, "og:title");
  const description = getMetaContent(document, "og:description");
  const url = getMetaContent(document, "og:url");
  const type = getMetaContent(document, "og:type");
  const image = getMetaContent(document, "og:image");

  const required = { title, url, type, image };
  const missing = Object.entries(required)
    .filter(([, value]) => value === null)
    .map(([key]) => `og:${key}`);

  if (missing.length > 0) {
    const html = missing.map((tag) => `<meta property="${tag}" content="some value"/>`);
    throw new Error(
      `Missing required meta tags: ${missing.join(", ")}. Add the following to your page:\n${html.join("\n")}`,
    );
  }

  // After the check above, these values are guaranteed to be non-null strings
  const safeTitle = title ?? "";
  const safeUrl = url ?? "";
  const safeType = type ?? "";
  const safeImage = image ?? "";
  const returnVal: PageDetails = { title: safeTitle, url: safeUrl, type: safeType, image: safeImage };
  if (description !== null && description !== title) {
    returnVal.description = description;
  }
  return returnVal;
}
