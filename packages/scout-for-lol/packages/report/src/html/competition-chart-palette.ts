import chroma from "chroma-js";
import { palette } from "#src/assets/colors.ts";

/**
 * Anchor stops for the leaderboard series palette.
 *
 * Hand-picked to span the hue wheel with distinguishable midpoints:
 * - the warm half from the LoL brand (gold, burnt gold, red)
 * - the cool half from the LoL brand (teal, sky, sapphire)
 * - one synthetic violet (`#7d4e9e`) bridges the cool→red gap so the
 *   interpolation doesn't dive through muddy greens. The violet sits in
 *   a hue range LoL doesn't use natively but reads as a tasteful accent
 *   alongside the brand colors rather than off-brand.
 *
 * Anchors are arranged warm → cool → bridge → warm so adjacent series get
 * meaningfully different hues even without symbol/dash variation.
 */
const SERIES_ANCHORS = [
  palette.gold.bright, // #f0bf3a — primary warm
  palette.gold[4], //    #C89B3C — burnt gold
  palette.blue[2], //    #0AC8B9 — primary cool (teal)
  palette.teams.blue, // #60c8e4 — sky
  palette.blue[4], //    #005A82 — sapphire
  "#7d4e9e", //          synthetic violet bridge
  palette.teams.red, //  #ad3138 — accent / contrast
];

/**
 * Generate `count` distinct series colors interpolated through the
 * `SERIES_ANCHORS` stops in LCH space.
 *
 * LCH is perceptually-uniform-ish: equal steps along the scale look like
 * equal visual gaps, much better than naive RGB interpolation (which
 * produces muddy midpoints). Plain `scale().mode('lch')` (no bezier) is
 * used deliberately — bezier smoothing collapsed the middle of the
 * gradient into near-grey when we tried it.
 *
 * Stable: rank 1 is always `palette.gold.bright`; rank N (last) is always
 * close to `palette.teams.red`. So colors don't shuffle when the number of
 * series changes between charts — gold = leader, red = trailing.
 *
 * Always returns at least one color.
 */
export function generateSeriesPalette(count: number): string[] {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [palette.gold.bright];
  }
  return chroma.scale(SERIES_ANCHORS).mode("lch").colors(count);
}
