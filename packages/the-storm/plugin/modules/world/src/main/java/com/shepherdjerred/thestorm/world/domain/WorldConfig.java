package com.shepherdjerred.thestorm.world.domain;

import java.util.HashSet;
import java.util.List;

/**
 * plugins/TheStorm/world.yml. Paper already owns the main world, the nether and the end; this file
 * lists only the worlds the module creates.
 *
 * @param sleepPercentage players in bed required to skip the night, on every overworld
 * @param worlds the created worlds, in order; the first with {@code rtp} is the default landing
 */
public record WorldConfig(int sleepPercentage, List<WorldSpec> worlds) {

  public WorldConfig {
    worlds = List.copyOf(worlds);
    if (sleepPercentage < 1 || sleepPercentage > 100) {
      throw new IllegalArgumentException("sleepPercentage must be 1-100: " + sleepPercentage);
    }
    if (worlds.isEmpty()) {
      throw new IllegalArgumentException("worlds must not be empty");
    }
    var names = new HashSet<String>();
    var teleport = false;
    for (var world : worlds) {
      if (!names.add(world.name())) {
        throw new IllegalArgumentException("world " + world.name() + " is listed twice");
      }
      teleport = teleport || world.rtp();
    }
    if (!teleport) {
      throw new IllegalArgumentException("at least one world must allow random teleport");
    }
  }
}
