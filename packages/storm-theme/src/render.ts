import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ThemeIdSchema, themeCatalog } from "./catalog.ts";

export const CardSchema = z
  .object({
    theme: ThemeIdSchema,
    title: z.string().min(1).max(250),
    section: z.string().min(1).max(80),
    description: z.string().max(180),
  })
  .strict();
export type StormCard = z.infer<typeof CardSchema>;

const assets = new URL("../assets/", import.meta.url);
async function dataImage(path: string, type: string) {
  const bytes = await readFile(new URL(path, assets));
  return `data:${type};base64,${bytes.toString("base64")}`;
}
const font = readFile(
  import.meta
    .resolve("@fontsource/roboto/files/roboto-latin-400-normal.woff")
    .replace("file://", ""),
);
const bold = readFile(
  import.meta
    .resolve("@fontsource/roboto/files/roboto-latin-700-normal.woff")
    .replace("file://", ""),
);
const element = (type: string, props: Record<string, unknown>) => ({
  type,
  props,
  key: null,
});

export async function renderCard(input: StormCard): Promise<Uint8Array> {
  const card = CardSchema.parse(input);
  const theme = themeCatalog.themes.find(
    (candidate) => candidate.id === card.theme,
  );
  if (!theme) throw new Error("Missing Storm card theme");
  const palette = theme.palettes.dark;
  const scenery = themeCatalog.scenery[theme.scenery];
  if (!scenery) throw new Error("Missing Storm card scenery");
  const [background, logo, regular, strong] = await Promise.all([
    dataImage(scenery.desktop, "image/jpeg"),
    dataImage(theme.contentLogos.dark, "image/svg+xml"),
    font,
    bold,
  ]);
  const svg = await satori(
    element("div", {
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
        position: "relative",
        backgroundColor: palette.chromeBg,
        fontFamily: "Roboto",
      },
      children: [
        element("img", {
          src: background,
          width: 1200,
          height: 630,
          style: { position: "absolute", objectFit: "cover" },
        }),
        element("div", {
          style: {
            display: "flex",
            position: "absolute",
            width: "100%",
            height: "100%",
            backgroundColor: "rgba(0,0,0,0.6)",
          },
        }),
        element("div", {
          style: {
            display: "flex",
            position: "absolute",
            left: 48,
            top: 40,
            right: 48,
            bottom: 40,
            flexDirection: "column",
            padding: 40,
            borderRadius: 16,
            backgroundColor: palette.contentBg,
            borderTop: `8px solid ${palette.accent}`,
          },
          children: [
            element("div", {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              },
              children: [
                element("img", { src: logo, width: 330, height: 101 }),
                element("div", {
                  style: {
                    display: "flex",
                    color: palette.textColorMuted,
                    fontSize: 24,
                  },
                  children: "ts-mc.net",
                }),
              ],
            }),
            element("div", {
              style: {
                display: "flex",
                marginTop: 26,
                color: palette.linkColor,
                fontSize: 24,
                fontWeight: 700,
              },
              children: card.section,
            }),
            element("div", {
              style: {
                display: "flex",
                marginTop: 14,
                color: palette.textColor,
                fontSize:
                  card.title.length > 90
                    ? 36
                    : card.title.length > 55
                      ? 44
                      : 54,
                fontWeight: 700,
                lineHeight: 1.13,
                maxHeight: 190,
                overflow: "hidden",
              },
              children: card.title,
            }),
            element("div", {
              style: {
                display: "flex",
                marginTop: 20,
                color: palette.textColorDimmed,
                fontSize: 24,
                lineHeight: 1.35,
                maxHeight: 70,
                overflow: "hidden",
              },
              children: card.description,
            }),
            element("div", {
              style: {
                display: "flex",
                position: "absolute",
                bottom: 22,
                right: 40,
                color: palette.textColorMuted,
                fontSize: 20,
              },
              children: theme.name,
            }),
          ],
        }),
      ],
    }),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Roboto", data: regular, weight: 400, style: "normal" },
        { name: "Roboto", data: strong, weight: 700, style: "normal" },
      ],
    },
  );
  return new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
}
