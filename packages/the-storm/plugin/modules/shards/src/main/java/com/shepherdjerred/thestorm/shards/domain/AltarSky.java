package com.shepherdjerred.thestorm.shards.domain;

/**
 * The weather over an altar. The windmill only turns in the storm: an upgrade needs rain (or
 * thunder) falling as rain, not snow, in a biome that has precipitation at all.
 *
 * <p>Paper exposes no biome-precipitation API, so this derives it the way vanilla does: a biome
 * with no precipitation (desert, savanna, badlands) has zero downfall, and one whose temperature at
 * the altar's height is below {@link #SNOW_BELOW} snows instead of raining. The Nether and the End
 * share the overworld's weather flag but never rain, so they are excluded outright.
 *
 * @param overworld whether the altar is in an overworld-type dimension
 * @param worldStorming whether the world is raining or thundering
 * @param temperature the biome temperature at the altar block (height-adjusted)
 * @param downfall the biome's downfall (humidity)
 */
public record AltarSky(
    boolean overworld, boolean worldStorming, double temperature, double downfall) {

  /** Vanilla's snow line: below this temperature, precipitation falls as snow. */
  public static final double SNOW_BELOW = 0.15;

  /** Whether rain is falling at the altar. */
  public boolean raining() {
    return overworld && worldStorming && downfall > 0 && temperature >= SNOW_BELOW;
  }
}
