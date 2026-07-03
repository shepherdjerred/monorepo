import React from "react";
import type { RenderFunctionInput } from "astro-opengraph-images";

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
