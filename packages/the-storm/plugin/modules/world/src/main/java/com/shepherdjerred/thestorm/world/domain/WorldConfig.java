package com.shepherdjerred.thestorm.world.domain;

import java.util.HashSet;
import java.util.List;

/**
 * plugins/TheStorm/world.yml. Paper already owns the main world, the nether and the end; this file
 * lists the resource worlds operators provision before startup.
 *
 * @param sleepPercentage players in bed required to skip the night, on every overworld
 * @param worlds the provisioned worlds, in order; the first with {@code rtp} is the default landing
 * @param borders native borders for the preserved worlds
 * @param crier main-world bulletin command
 * @param ambient main-world arrival barks
 * @param digest recorded main-world daily activity under {@code /crier digest}
 * @param merchant event-triggered windmill trader visit, disabled until anchor verification
 */
public record WorldConfig(
    int sleepPercentage,
    List<WorldSpec> worlds,
    List<WorldBorderSpec> borders,
    CrierConfig crier,
    AmbientConfig ambient,
    DigestConfig digest,
    MerchantConfig merchant) {

  public WorldConfig {
    worlds = List.copyOf(worlds);
    borders = List.copyOf(borders);
    var bordered = new HashSet<String>();
    for (var border : borders) {
      if (!bordered.add(border.world())) {
        throw new IllegalArgumentException("border world " + border.world() + " is listed twice");
      }
    }
    if (crier == null) {
      throw new IllegalArgumentException("crier config is required");
    }
    if (ambient == null) {
      throw new IllegalArgumentException("ambient config is required");
    }
    if (digest == null) {
      throw new IllegalArgumentException("digest config is required");
    }
    if (merchant == null) {
      throw new IllegalArgumentException("merchant config is required");
    }
    if (digest.enabled() && !crier.enabled()) {
      throw new IllegalArgumentException("the daily digest requires the crier command");
    }
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
