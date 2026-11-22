package com.shepherdjerred.thestorm.rwf.adapter.remote;

import java.net.URI;

/**
 * The managed {@code the-storm-rwf-kits-enabled} flag: the full kit list, the kit shop and the
 * weekly free rotation, per player. The identifier is checked against the shared flag inventory at
 * build time.
 */
public final class FliptRwfKitsGate {

  private static final String FLAG_KEY = "the-storm-rwf-kits-enabled";

  private FliptRwfKitsGate() {}

  /** The flag at {@code base} in {@code deployment}, evaluated in {@code world}. */
  public static FliptPlayerFlag create(URI base, String deployment, String world) {
    return new FliptPlayerFlag(base, deployment, world, FLAG_KEY);
  }
}
