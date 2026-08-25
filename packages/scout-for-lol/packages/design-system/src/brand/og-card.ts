import { createElement, type ReactNode } from "react";
import { scoutThemes } from "#src/generated/tokens.ts";
import { ScoutEmblem } from "./emblem.ts";

export function scoutOgCard(input: {
  title: string;
  description?: string;
}): ReactNode {
  const colors = scoutThemes["modern-light"].colors;
  const hasDescription =
    input.description !== undefined && input.description.length > 0;
  return createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "80px",
        color: colors.text,
        fontFamily: "Spiegel",
        backgroundColor: colors.canvas,
      },
    },
    createElement(
      "div",
      { style: { display: "flex", alignItems: "center" } },
      createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "84px",
            height: "84px",
            borderRadius: "12px",
            border: `2px solid ${colors.primary}`,
            backgroundColor: colors.surface,
            color: colors.primary,
          },
        },
        createElement(ScoutEmblem, { width: 62, height: 62 }),
      ),
      createElement(
        "div",
        {
          style: {
            marginLeft: "28px",
            fontFamily: "Spiegel",
            fontWeight: 600,
            fontSize: "34px",
            color: colors.text,
          },
        },
        "scout-for-lol.com",
      ),
    ),
    createElement("div", { style: { display: "flex", flexGrow: 1 } }),
    createElement(
      "div",
      {
        style: {
          display: "flex",
          fontFamily: "Beaufort for LoL",
          fontWeight: 700,
          fontSize: "76px",
          lineHeight: 1.08,
          letterSpacing: "-1px",
        },
      },
      input.title,
    ),
    hasDescription
      ? createElement(
          "div",
          {
            style: {
              display: "flex",
              marginTop: "28px",
              maxHeight: "160px",
              overflow: "hidden",
              fontFamily: "Spiegel",
              fontWeight: 400,
              fontSize: "36px",
              lineHeight: 1.35,
              color: colors.textMuted,
            },
          },
          input.description,
        )
      : null,
  );
}
