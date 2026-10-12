package com.shepherdjerred.thestorm.rwf.adapter.remote;

import java.net.URI;

/**
 * The managed {@code the-storm-rwf-kits-enabled} flag: the full kit list, the kit shop and the
 * weekly free rotation, per player. The identifiers are checked against the shared flag inventory
 * at build time.
 */
public final class FliptRwfKitsGate {

  private static final String NAMESPACE_KEY = "the-storm";
  private static final String FLAG_KEY = "the-storm-rwf-kits-enabled";

  private FliptRwfKitsGate() {}

  /** The flag at {@code base} in {@code environment}, evaluated in {@code world}. */
  public static FliptPlayerFlag create(URI base, String environment, String world) {
    return new FliptPlayerFlag(
        base, environment, world, new FliptPlayerFlag.Key(NAMESPACE_KEY, FLAG_KEY));
  }
}
