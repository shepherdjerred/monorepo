import { expect, it } from "vitest";
import { replaceFigures } from "#src/capture/suite/embeds.ts";
import { mediaFigure, mediaMarkup } from "#protocol/media-markup.ts";
import { PublicMediaSchema } from "#protocol/media.ts";

const manifest = PublicMediaSchema.parse({
  schema: 1,
  name: "help-mail",
  kind: "image",
  width: 1280,
  height: 720,
  src: "/media/help-mail/original.webp",
  poster: "/media/help-mail/poster.webp",
  alt: "Help",
  caption: "Updated help.",
  annotations: [],
});
const manifests = new Map([[manifest.name, manifest]]);
const legacy = mediaFigure(manifest).replace(
  "</figcaption>",
  ' <a href="/media/help-mail/annotated.webp">Download annotated image</a>.</figcaption>',
);

it("retains an annotated download when replacing a legacy inline-caption link", () => {
  const rendered = replaceFigures(legacy, manifests);
  expect(rendered).toBe(mediaMarkup(manifest));
  expect(replaceFigures(rendered, manifests)).toBe(rendered);
});

it("keeps an existing external download without adding a duplicate", () => {
  const download =
    '<p><a href="/media/help-mail/annotated.webp" download>Download annotated image</a></p>';
  expect(replaceFigures(`${legacy}\n${download}`, manifests)).toBe(
    mediaMarkup(manifest),
  );
  expect(replaceFigures(mediaMarkup(manifest), manifests)).toBe(
    mediaMarkup(manifest),
  );
  const formatted =
    '<p>\n<a download href="/media/help-mail/annotated.webp">Existing download</a>\n</p>';
  expect(replaceFigures(`${legacy}\n${formatted}`, manifests)).toBe(
    `${mediaFigure(manifest)}\n${formatted}`,
  );
});
