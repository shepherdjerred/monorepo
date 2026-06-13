import playerJs from "asciinema-player/dist/bundle/asciinema-player.min.js" with { type: "text" };
import playerCss from "asciinema-player/dist/bundle/asciinema-player.css" with { type: "text" };

/** Escape a string for safe interpolation into HTML text content. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * A literal `</script` inside inlined JS would terminate the surrounding
 * `<script>` element early. Escaping the slash is a no-op in JS string,
 * comment, and regex contexts, so the bundle behaves identically.
 */
function escapeInlineScript(js: string): string {
  return js.replaceAll("</script", String.raw`<\/script`);
}

/**
 * Render a self-contained HTML page that plays an asciinema recording. The
 * player JS and CSS are inlined (no CDN, no extra objects), and the cast is
 * fetched via a relative URL, so the page works wherever the
 * `<name>.cast` / `<name>.cast.html` pair is uploaded together.
 */
export function renderCastPlayerHtml(castBasename: string): string {
  // encodeURIComponent leaves no `<`, `"`, or `/` in the basename, so the
  // JSON-quoted ref is safe to interpolate into the inline script as-is.
  const castRef = JSON.stringify(`./${encodeURIComponent(castBasename)}`);
  const title = escapeHtml(castBasename);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — terminal recording</title>
<style>${playerCss}</style>
<style>
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #121314; }
#player { width: min(100ch, 96vw); }
</style>
</head>
<body>
<div id="player"></div>
<script>${escapeInlineScript(playerJs)}</script>
<script>
AsciinemaPlayer.create(${castRef}, document.getElementById("player"), { fit: "width" });
</script>
</body>
</html>
`;
}
