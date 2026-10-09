import type { RenderFunctionInput } from "#src/types.js";
import { simpleBlog } from "./simple-blog.tsx";

// This preset demonstrates how to extract arbitrary content from an HTML file
// and render it in an Open Graph image.
export function customProperty(input: RenderFunctionInput): React.ReactNode {
  // extract the body
  const body = input.document.querySelector("body")?.textContent ?? "";
  // truncate the body to 50 characters, add ellipsis if truncated
  const bodyTruncated = body.slice(0, 50) + (body.length > 50 ? "..." : "");

  return simpleBlog({ ...input, description: bodyTruncated });
}
