/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import React from "react";
import type { RenderFunctionInput } from "astro-opengraph-images";

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
// Mirrors the marketing site's identity: indigo→violet gradient, the gradient
// "S" badge from the Navbar, page title in Beaufort for LoL, description in
// Spiegel. Fonts are registered in astro.config.mjs and referenced by name.
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
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "80px",
        color: "#ffffff",
        fontFamily: "Spiegel",
        backgroundColor: "#312e81",
        backgroundImage:
          "linear-gradient(135deg, #4338ca 0%, #6d28d9 55%, #7c3aed 100%)",
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
            borderRadius: "20px",
            backgroundImage: "linear-gradient(135deg, #2563eb, #9333ea)",
            fontFamily: "Beaufort for LoL",
            fontWeight: 700,
            fontSize: "48px",
            color: "#ffffff",
          }}
        >
          S
        </div>
        <div
          style={{
            marginLeft: "28px",
            fontFamily: "Spiegel",
            fontWeight: 600,
            fontSize: "34px",
            color: "rgba(255,255,255,0.92)",
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
            color: "rgba(255,255,255,0.85)",
          }}
        >
          {description}
        </div>
      ) : null}
    </div>
  );
}
