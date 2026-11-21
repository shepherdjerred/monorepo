/**
 * Imported for its effect, before any module that builds a schema.
 *
 * zod compiles object parsers with `new Function` when the page allows it,
 * and finds out by trying once, as the first object schema is built. Media's
 * Content-Security-Policy allows no script evaluated from a string, so a
 * browser would report that attempt as a violation on every page load.
 * `jitless` skips the attempt and keeps the interpreting parser, the one the
 * policy would leave zod with anyway.
 *
 * The build keeps this module in zod's own chunk (`vite.config.ts`), so it
 * also runs before the schemas in every other chunk.
 */
import { z } from "zod";

z.config({ jitless: true });
