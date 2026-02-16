import type { RenderFunctionInput } from "astro-opengraph-images";
import { createElement } from "react";
const { twj } = await import("tw-to-css");

export function customOgMediaLayout({ title }: RenderFunctionInput): Promise<React.ReactNode> {
  return Promise.resolve(
    createElement(
      "div",
      {
        style: {
          ...twj("h-full w-full flex items-start justify-start"),
          backgroundImage: "linear-gradient(to right, #24243e, #302b63, #0f0c29)",
        },
      },
      createElement(
        "div",
        { style: twj("flex items-start justify-start h-full") },
        createElement(
          "div",
          { style: twj("flex flex-col justify-between w-full h-full p-20") },
          createElement("h1", { style: twj("text-[60px] text-white font-bold text-left") }, title as string),
        ),
      ),
    ),
  );
}
