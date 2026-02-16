import type { AstroIntegration } from "astro";
import type { AstroBuildDoneHookInput, IntegrationDefaults, IntegrationInput, IntegrationOptions } from "./types.js";
import { buildDoneHook } from "./hook.js";

const defaults: IntegrationDefaults = {
  width: 1200,
  height: 630,
  verbose: false,
};

export function astroOpenGraphImages({ options, render }: IntegrationInput): AstroIntegration {
  const optionsWithDefaults: IntegrationOptions = { ...defaults, ...options };

  return {
    name: "astro-opengraph-images",
    hooks: {
      "astro:build:done": async (entry: AstroBuildDoneHookInput) => {
        return buildDoneHook({
          ...entry,
          options: optionsWithDefaults,
          render,
        });
      },
    },
  };
}
