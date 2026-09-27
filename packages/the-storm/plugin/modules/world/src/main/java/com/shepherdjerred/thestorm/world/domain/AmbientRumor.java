package com.shepherdjerred.thestorm.world.domain;

import java.util.List;

/** A weather-grounded bark and one rotating fact from the recovered Storm history. */
public final class AmbientRumor {

  private static final List<String> MEMORIES =
      List.of(
          "Old hands remember using the windmill's emerald pad for Storm Shards when it rained.",
          "The old spawn had a blacksmith, bakery, watchtowers, and this windmill.",
          "Braxton tended the Crystal Bank when it opened in 2015.",
          "Twenty-one eggs were hidden for the April 2015 Easter hunt.");

  private AmbientRumor() {}

  /** The real Pacific date selects a stable memory; weather comes from the current main world. */
  public static String atSpawn(long epochDay, boolean storming, boolean thundering) {
    var weather =
        thundering
            ? "Thunder rolls above the windmill."
            : storming ? "Rain rattles the windmill sails." : "The sky is clear at the windmill.";
    var memory = MEMORIES.get(Math.floorMod(epochDay, MEMORIES.size()));
    return "Crier: " + weather + " " + memory;
  }
}
