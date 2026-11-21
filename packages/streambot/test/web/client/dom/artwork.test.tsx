// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { Artwork } from "@shepherdjerred/streambot/web/client/media/artwork.tsx";
import { mount, type Mounted } from "./harness.ts";

let view: Mounted;

afterEach(async () => {
  await view.unmount();
});

async function render(
  kind: "library" | "song" | "video",
  shape: "thumb" | "poster",
): Promise<HTMLImageElement> {
  view = await mount(
    <Artwork item={{ kind, artworkUrl: "/art.png" }} shape={shape} />,
  );
  const image = view.container.querySelector("img");
  if (image === null) throw new Error("expected an image");
  return image;
}

describe("Artwork box", () => {
  test("a Plex title is a 2:3 poster", async () => {
    const image = await render("library", "poster");
    expect(image.className).toContain("artwork-tall");
    expect([image.width, image.height]).toEqual([200, 300]);
  });

  test("music art is square", async () => {
    const image = await render("song", "poster");
    expect(image.className).toContain("artwork-square");
    expect([image.width, image.height]).toEqual([200, 200]);
  });

  test("a video is 16:9", async () => {
    const image = await render("video", "poster");
    expect(image.className).toContain("artwork-wide");
    expect([image.width, image.height]).toEqual([320, 180]);
  });

  test("a row thumbnail stays 44px square whatever the kind", async () => {
    const image = await render("library", "thumb");
    expect(image.className).toContain("artwork-thumb");
    expect([image.width, image.height]).toEqual([44, 44]);
  });
});
