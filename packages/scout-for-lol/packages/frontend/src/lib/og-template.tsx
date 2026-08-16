/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import React from "react";
import type { RenderFunctionInput } from "astro-opengraph-images";
import { ScoutEmblem } from "@scout-for-lol/design-system/brand";
import { scoutThemes } from "@scout-for-lol/design-system/themes";

// This file is imported directly by `astro.config.mjs`, so Astro's config
// loader (esbuild) transpiles it on the fly. In CI's container that transpile
// selects the *dev* automatic JSX runtime and emits `jsxDEV(...)` calls whose
// `react/jsx-dev-runtime` import gets stripped from the config bundle — leaving
// `jsxDEV` undefined and crashing the `astro:build:done` OG-image hook. The
// pragmas above pin this file to the classic runtime so JSX compiles to
// `React.createElement` (React is imported below and always resolves),
// independent of the ambient transpile mode. Do not remove them.
//
// Branded Open Graph template rendered by astro-opengraph-images (Satori).
// Uses the same resolved modern-dark tokens, emblem, and font bytes as the
// shared browser design system. Fonts are registered in astro.config.mjs.
//
// Satori constraints: every element with more than one child must set
// `display: flex`; there is no `gap` support (use margins); text needs an
// explicit font family that is provided to Satori.
export function ogTemplate({
  title,
  description,
}: RenderFunctionInput): React.ReactNode {
  const hasDescription =
    typeof description === "string" && description.length > 0;
  const colors = scoutThemes["modern-dark"].colors;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "80px",
        color: colors.text,
        fontFamily: "Spiegel",
        backgroundColor: colors.canvas,
        backgroundImage: `linear-gradient(135deg, ${colors.canvas} 0%, ${colors.surface} 55%, ${colors.primary} 100%)`,
      }}
    >
      {/* Brand row */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "84px",
            height: "84px",
            borderRadius: "12px",
            border: `2px solid ${colors.primary}`,
            backgroundColor: colors.surface,
            fontFamily: "Beaufort for LoL",
            fontWeight: 700,
            fontSize: "48px",
            color: colors.primary,
          }}
        >
          <ScoutEmblem width={62} height={62} />
        </div>
        <div
          style={{
            marginLeft: "28px",
            fontFamily: "Spiegel",
            fontWeight: 600,
            fontSize: "34px",
            color: colors.text,
          }}
        >
          scout-for-lol.com
        </div>
      </div>

      {/* Spacer */}
      <div style={{ display: "flex", flexGrow: 1 }} />

      {/* Title */}
      <div
        style={{
          display: "flex",
          fontFamily: "Beaufort for LoL",
          fontWeight: 700,
          fontSize: "76px",
          lineHeight: 1.08,
          letterSpacing: "-1px",
        }}
      >
        {title}
      </div>

      {/* Description */}
      {hasDescription ? (
        <div
          style={{
            display: "flex",
            marginTop: "28px",
            // Cap the block so long copy can't overflow the fixed 1200×630
            // canvas: ~4 lines at 36px/1.35 line-height. Satori clips the
            // overflow instead of bleeding past the image edge.
            maxHeight: "160px",
            overflow: "hidden",
            fontFamily: "Spiegel",
            fontWeight: 400,
            fontSize: "36px",
            lineHeight: 1.35,
            color: colors.textMuted,
          }}
        >
          {description}
        </div>
      ) : null}
    </div>
  );
}
