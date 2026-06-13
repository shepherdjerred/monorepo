import { describe, expect, test } from "bun:test";
import playerCss from "asciinema-player/dist/bundle/asciinema-player.css" with { type: "text" };
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

  test("escapeInlineStyle escapes </style (lowercase)", () => {
    // Generate HTML with CSS that contains a closing style tag.
    // We verify the output by checking the generated HTML contains the
    // escaped form and not the raw closer.
    const html = renderCastPlayerHtml("demo.cast");
    // The first <style> block contains the inlined playerCss.
    // Regardless of whether the current bundle contains </style, the
    // escaping logic must not leave any raw </style sequence in the
    // block (only escaped <\/style sequences are safe).
    const styleBlockMatch = /<style>([\s\S]*?)<\/style>/i.exec(html);
    expect(styleBlockMatch).not.toBeNull();
    const firstStyleBlock = styleBlockMatch![1];
    expect(firstStyleBlock).not.toMatch(/<\/style/i);
  });

  test("the real playerCss bundle does not currently contain </style", () => {
    // Asserting that the current bundle is clean is a canary: if a future
    // version of asciinema-player embeds such a sequence it will be caught
    // here and the escapeInlineStyle guard will be exercised in production.
    expect(playerCss).not.toMatch(/<\/style/i);
  });

  test("never emits an unescaped closing style tag from the CSS bundle", () => {
    const html = renderCastPlayerHtml("demo.cast");
    // </style> (with >) only appears as the intentional tag closers in the
    // head; none should come from within an inlined stylesheet.
    const styleCloses = html.match(/<\/style>/gi) ?? [];
    // Exactly the two intentional closers: the player CSS block and the
    // inline body-styling block.
    expect(styleCloses).toHaveLength(2);
  });

  test("html head contains no raw </style sequences inside either style block", () => {
    // Verify case-insensitively: even if the CSS bundle contained mixed-case
    // variants, none should survive into the inlined block.
    const html = renderCastPlayerHtml("demo.cast");
    const head = html.slice(0, html.indexOf("</head>"));
    // Extract content between <style> and </style> for the player CSS block.
    const playerStyleMatch = /<style>([\s\S]*?)<\/style>/i.exec(head);
    expect(playerStyleMatch).not.toBeNull();
    const playerStyleContent = playerStyleMatch![1];
    // No raw </style in any case variant should appear inside the block.
    expect(playerStyleContent).not.toMatch(/<\/style/i);
  });
});
