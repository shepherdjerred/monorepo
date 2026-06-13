import { describe, expect, test } from "bun:test";
import { renderCastPlayerHtml } from "#lib/s3/cast-player.ts";

describe("renderCastPlayerHtml", () => {
  test("references the cast via a relative URL", () => {
    const html = renderCastPlayerHtml("demo.cast");
    expect(html).toContain('AsciinemaPlayer.create("./demo.cast"');
  });

  test("inlines the player bundle and stylesheet", () => {
    const html = renderCastPlayerHtml("demo.cast");
    // The page must be self-contained: no external script/style references.
    expect(html).toContain("AsciinemaPlayer");
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain('<link rel="stylesheet"');
    // Sanity: the real bundle (not a stub) is inlined.
    expect(html.length).toBeGreaterThan(100_000);
  });

  test("escapes hostile basenames in the title and cast reference", () => {
    const hostile = '<script>alert("x")</script>.cast';
    const html = renderCastPlayerHtml(hostile);
    expect(html).not.toContain("<title><script>");
    expect(html).toContain("&lt;script&gt;");
    // The cast URL is percent-encoded, so no raw angle brackets or quotes
    // survive inside the inline player script call.
    expect(html).toContain(
      'AsciinemaPlayer.create("./%3Cscript%3Ealert(%22x%22)%3C%2Fscript%3E.cast"',
    );
  });

  test("never emits an unescaped closing script tag from the bundle", () => {
    const html = renderCastPlayerHtml("demo.cast");
    const body = html.slice(html.indexOf("<body>"));
    const scriptCloses = body.match(/<\/script>/g) ?? [];
    // Exactly the two intentional closers: the inlined bundle and the
    // bootstrap call.
    expect(scriptCloses).toHaveLength(2);
  });
});
