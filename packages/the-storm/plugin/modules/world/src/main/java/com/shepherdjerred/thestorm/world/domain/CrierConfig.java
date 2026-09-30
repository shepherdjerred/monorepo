package com.shepherdjerred.thestorm.world.domain;

/** The on-demand crier reports only the configured main world. */
public record CrierConfig(boolean enabled, String world) {

  public CrierConfig {
    if (!"world".equals(world)) {
      throw new IllegalArgumentException("crier is restricted to the main world");
    }
  }
}
