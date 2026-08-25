/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type { ReactNode } from "react";
import type { RenderFunctionInput } from "astro-opengraph-images";
import { scoutOgCard } from "@scout-for-lol/design-system/satori/og-card";

// This file is imported directly by `astro.config.mjs`, so Astro's config
// loader (esbuild) transpiles it on the fly. In CI's container that transpile
// selects the *dev* automatic JSX runtime and emits `jsxDEV(...)` calls whose
// `react/jsx-dev-runtime` import gets stripped from the config bundle — leaving
// `jsxDEV` undefined and crashing the `astro:build:done` OG-image hook. The
// pragmas above pin this file to the classic runtime so JSX compiles to
// `React.createElement`, independent of the ambient transpile mode.
export function ogTemplate({
  title,
  description,
}: RenderFunctionInput): ReactNode {
  if (typeof description === "string") {
    return scoutOgCard({ title, description });
  }
  return scoutOgCard({ title });
}
