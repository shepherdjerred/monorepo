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
  // Stop at the first grapheme past the limit instead of segmenting the page.
  let bodyTruncated = body;
  let count = 0;
  for (const { index } of graphemes.segment(body)) {
    if (count === MAX_BODY_GRAPHEMES) {
      bodyTruncated = `${body.slice(0, index)}...`;
      break;
    }
    count++;
  }

  return simpleBlog({ ...input, description: bodyTruncated });
}
