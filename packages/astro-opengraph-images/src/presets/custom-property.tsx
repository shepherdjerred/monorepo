import type { RenderFunctionInput } from "#src/types.js";
import { simpleBlog } from "./simple-blog.tsx";

const MAX_BODY_GRAPHEMES = 50;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// This preset demonstrates how to extract arbitrary content from an HTML file
// and render it in an Open Graph image.
export function customProperty(input: RenderFunctionInput): React.ReactNode {
  // extract the body
  const body = input.document.querySelector("body")?.textContent ?? "";
  // truncate the body to 50 visible characters, add ellipsis if truncated.
  // Grapheme segmentation keeps emoji, flags, and combining marks whole.
  const segments = Array.from(
    graphemes.segment(body),
    ({ segment }) => segment,
  );
  const bodyTruncated =
    segments.length > MAX_BODY_GRAPHEMES
      ? `${segments.slice(0, MAX_BODY_GRAPHEMES).join("")}...`
      : body;

  return simpleBlog({ ...input, description: bodyTruncated });
}
