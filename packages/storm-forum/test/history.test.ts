import { describe, expect, it } from "vitest";
import { HistorySchema, historicalDate, restoreMessage } from "#src/history.ts";
import corpus from "#config/history.json";
import { parseDocument } from "htmlparser2";
import { archiveBBCode, findAll, originalUrl } from "#src/archive-html.ts";

describe("reviewed history corpus", () => {
  it("contains substantial public discussions with unique identities", () => {
    const history = HistorySchema.parse(corpus);
    expect(history.threads).toHaveLength(120);
    expect(history.users).toHaveLength(73);
    expect(history.users.filter((user) => user.avatar !== null)).toHaveLength(
      17,
    );
    expect(history.attachments).toHaveLength(19);
    expect(
      history.threads
        .flatMap((thread) => thread.posts)
        .filter((post) => post.originalPostId === null),
    ).toHaveLength(17);
    expect(
      history.threads.find((thread) => thread.originalId === 33)?.posts[0]
        ?.message,
    ).toContain("[B]");
    expect(
      history.threads.find((thread) => thread.originalId === 33)?.posts[0]
        ?.attachments,
    ).toEqual(expect.arrayContaining([7, 10, 12]));
    expect(
      history.users.find((user) => user.originalId === 196)?.aliases,
    ).toEqual(expect.arrayContaining(["XMrMoiXx", "yolksoup"]));
    expect(
      history.threads.reduce((total, thread) => total + thread.posts.length, 0),
    ).toBe(1148);
    expect(
      history.threads.filter((thread) => thread.reconstructed),
    ).toHaveLength(9);
    expect(
      history.omitted.some((thread) => thread.reason.includes("Private")),
    ).toBe(true);
    expect(
      history.threads.every((thread) =>
        thread.posts.every((post) => post.date < Date.UTC(2017, 0, 1) / 1000),
      ),
    ).toBe(true);
  });
  it("recovers native formatting, links, attachments, and supported media while discarding executable HTML", () => {
    const doc = parseDocument(
      '<div><h2>Heading</h2><p><b>Bold</b> <i>Italic</i> <a href="threads/example.42/">Read</a></p><ul><li>First</li><li>Second</li></ul><div class="bbCodeQuote"><div class="attribution">Riot said:</div><blockquote class="quote">Quoted</blockquote></div><pre>line 1\nline 2</pre><img src="attachments/example-png.24/" /><iframe src="https://www.youtube.com/embed/abc123"></iframe><script>alert(1)</script></div>',
    );
    const body = findAll((node) => node.name === "div", doc.children)[0];
    if (body === undefined) throw new Error("Missing HTML fixture");
    const message = archiveBBCode(body, new Map(), new Set([24]));
    expect(message).toContain("[HEADING=2]Heading[/HEADING]");
    expect(message).toContain("[B]Bold[/B] [I]Italic[/I]");
    expect(message).toContain(
      "[URL=https://ts-mc.net/threads/example.42/]Read[/URL]",
    );
    expect(message).toContain("[LIST][*]First\n[*]Second\n[/LIST]");
    expect(message).toContain('[QUOTE="Riot"]Quoted[/QUOTE]');
    expect(message).toContain("[CODE]line 1\nline 2[/CODE]");
    expect(message).toContain("[ATTACH]24[/ATTACH]");
    expect(message).toContain("[MEDIA=youtube]abc123[/MEDIA]");
    expect(message).not.toContain("alert");
    expect(originalUrl("javascript:alert(1)")).toBeUndefined();
    expect(originalUrl("https://user:password@example.test/")).toBeUndefined();
  });
  it("rejects attachment IDs claimed twice by one post or by another post", () => {
    const history = HistorySchema.parse(corpus);
    const posts = history.threads.flatMap((thread) => thread.posts);
    const owner = posts.find((post) => post.attachments.length > 0);
    const id = owner?.attachments[0];
    const other = posts.find((post) => post.key !== owner?.key);
    if (owner === undefined || other === undefined || id === undefined)
      throw new Error("Missing attachment ownership fixture");
    for (const target of [owner, other]) {
      const revision = structuredClone(history);
      const post = revision.threads
        .flatMap((thread) => thread.posts)
        .find((candidate) => candidate.key === target.key);
      if (post === undefined) throw new Error("Missing revision post");
      post.attachments.push(id);
      expect(() => HistorySchema.parse(revision)).toThrow(
        "Duplicate historical attachment ownership",
      );
    }
  });
  it("converts Mountain board dates across daylight saving without changing exact ISO timestamps", () => {
    expect(historicalDate(null, "Apr 6, 2014 at 10:42 PM")).toBe(
      Date.parse("2014-04-07T04:42:00Z") / 1000,
    );
    expect(historicalDate(null, "Dec 15, 2014 at 12:50 PM")).toBe(
      Date.parse("2014-12-15T19:50:00Z") / 1000,
    );
    expect(historicalDate("2014-04-07T04:42:23Z", "ignored")).toBe(
      Date.parse("2014-04-07T04:42:23Z") / 1000,
    );
    expect(() => historicalDate(null, "unknown")).toThrow();
  });
  it("restores local imagery and attributed quotes without hotlinking missing images", () => {
    expect(
      restoreMessage(
        "[quote=Riot]Hello[/quote]\n[img http://i.imgur.com/abc.png]\n[img https://missing.invalid/a.png]",
        new Map([["https://i.imgur.com/abc.png", "image.png"]]),
      ),
    ).toBe(
      '[QUOTE="Riot"]Hello[/quote]\n[IMG]/data/storm-history/image.png[/IMG]',
    );
  });
});
