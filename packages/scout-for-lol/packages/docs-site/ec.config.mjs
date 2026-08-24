import {
  scoutQlExpressiveCode,
  SCOUTQL_SHIKI_LANG_ALIAS,
} from "./src/lib/scoutql-expressive-code.ts";

/**
 * Expressive Code options live here rather than in `astro.config.ts` because
 * Starlight's `<Code>` component re-creates the renderer from a JSON copy of
 * the Astro config, and a plugin is a function — not serialisable. Astro
 * refuses with "Expressive Code options that are not serializable to JSON" and
 * names this file as the fix, so `reference/scoutql-render.mdx` (which uses
 * `<Code>`) would fail the build if the plugin were configured over there.
 *
 * ScoutQL fences are highlighted by the language's own tokenizer rather than a
 * TextMate grammar — see `src/lib/scoutql-expressive-code.ts`. The Shiki alias
 * only stops the unknown language from warning on every build; the plugin
 * replaces Shiki's plaintext styling entirely.
 */
export default {
  plugins: [scoutQlExpressiveCode()],
  shiki: { langAlias: SCOUTQL_SHIKI_LANG_ALIAS },
};
