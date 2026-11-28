import { describe, expect, it } from "vitest";
import { injectBridge } from "./html-inject.ts";

const SRC = "/_bridge/v1.js";
const TAG = `<script src="${SRC}"></script>`;

async function rewrite(html: string): Promise<string> {
  const stream = new Response(html).body;
  if (stream === null) throw new Error("no body");
  const out = injectBridge(
    stream,
    SRC,
    new Headers({ "Content-Type": "text/html; charset=utf-8" }),
  );
  return new Response(out).text();
}

describe("bridge injection", () => {
  it("puts the script first in a full document's head", async () => {
    const out = await rewrite(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>a</title></head><body></body></html>`,
    );
    expect(out).toContain(`<html lang="en">${TAG}<head>`);
    expect(out.split(TAG)).toHaveLength(2);
  });

  it("handles html without a head", async () => {
    const out = await rewrite(
      `<!doctype html><html><body><p>x</p></body></html>`,
    );
    expect(out).toContain(`<html>${TAG}<body>`);
  });

  it("handles a doctype with no html or head", async () => {
    const out = await rewrite(`<!doctype html><p>only</p>`);
    expect(out).toBe(`<!doctype html>${TAG}<p>only</p>`);
  });

  it("handles a fragment without a doctype", async () => {
    const out = await rewrite(`<p>fragment</p>`);
    expect(out).toBe(`${TAG}<p>fragment</p>`);
  });

  it("handles a head without html", async () => {
    const out = await rewrite(
      `<!doctype html><head><title>e</title></head><body></body>`,
    );
    expect(out).toContain(`<head>${TAG}<title>`);
  });

  it("handles uppercase tags and a leading comment", async () => {
    const out = await rewrite(
      `<!-- c --><!doctype html>\n<HTML><HEAD lang=x><title>f</title></HEAD><body></body></HTML>`,
    );
    expect(out.split(TAG)).toHaveLength(2);
    expect(out).toContain(`<HTML>${TAG}<HEAD`);
  });

  it("handles a title first, with a stylesheet link marked crossorigin", async () => {
    const out = await rewrite(
      `<!doctype html><title>g</title><link rel="stylesheet" href="./s.css"><p>x</p>`,
    );
    expect(out).toContain(`${TAG}<title>g</title>`);
    expect(out).toContain('crossorigin="anonymous"');
  });

  it("injects once however many elements follow", async () => {
    const out = await rewrite(`<div><span></span></div><div></div>`);
    expect(out.split(TAG)).toHaveLength(2);
  });
});
