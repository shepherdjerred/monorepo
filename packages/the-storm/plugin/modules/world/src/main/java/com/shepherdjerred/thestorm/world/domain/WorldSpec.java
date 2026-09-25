package com.shepherdjerred.thestorm.world.domain;

/**
 * One world this module creates.
 *
 * @param name the world folder name
 * @param preset {@code large_biomes} or {@code amplified}
 * @param rtp whether random teleport may land here
 */
public record WorldSpec(String name, String preset, boolean rtp) {

  public WorldSpec {
    if (name.isBlank()) {
      throw new IllegalArgumentException("world name must not be blank");
    }
    if (!preset.equals("large_biomes") && !preset.equals("amplified")) {
      throw new IllegalArgumentException("unknown world preset: " + preset);
    }
  }
}
