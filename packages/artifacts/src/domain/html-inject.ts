/**
 * Streams an HTML document through `HTMLRewriter`, adding the bridge script
 * before the first element whatever it is: `<html>` and `<head>` get it as
 * their first child, anything else (a fragment, a bare doctype, a leading
 * `<title>`) gets it in front. The rewriter never synthesizes a `<head>`, so
 * one `*` handler on the first element covers every shape. Stylesheet links
 * are marked `crossorigin` so they load from the opaque origin.
 */
export function injectBridge(
  body: ReadableStream<Uint8Array>,
  bridgeSrc: string,
  headers: Headers,
): ReadableStream<Uint8Array> {
  const tag = `<script src="${bridgeSrc}"></script>`;
  let injected = false;
  const rewritten = new HTMLRewriter()
    .on("*", {
      element(element) {
        if (injected) return;
        injected = true;
        if (element.tagName === "html" || element.tagName === "head")
          element.prepend(tag, { html: true });
        else element.before(tag, { html: true });
      },
    })
    .on("link", {
      element(element) {
        const rel = (element.getAttribute("rel") ?? "").toLowerCase();
        if (rel.split(/\s+/u).includes("stylesheet"))
          element.setAttribute("crossorigin", "anonymous");
      },
    })
    .transform(new Response(body, { headers }));
  if (rewritten.body === null) throw new Error("HTMLRewriter returned no body");
  return rewritten.body;
}
