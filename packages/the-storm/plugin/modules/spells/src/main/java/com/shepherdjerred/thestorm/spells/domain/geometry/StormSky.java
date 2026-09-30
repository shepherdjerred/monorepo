package com.shepherdjerred.thestorm.spells.domain.geometry;

/**
 * Whether rain is falling on a spot, which decides if Storm Call's lightning is real or only a
 * flash. Rain needs a storm, an open sky, and a biome that is neither snowy (below 0.15) nor dry
 * (vanilla's rainless biomes, deserts, savannas and badlands, are all warmer than 1.0).
 */
public final class StormSky {

  /** Below this, precipitation falls as snow. */
  public static final double SNOW_BELOW = 0.15;

  /** At or above this, a biome is dry. */
  public static final double DRY_FROM = 1.0;

  private StormSky() {}

  public static boolean rainsOn(boolean storm, boolean openSky, double temperature) {
    return storm && openSky && temperature >= SNOW_BELOW && temperature < DRY_FROM;
  }
}
