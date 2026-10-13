package com.shepherdjerred.thestorm.rwf.adapter.remote;

import java.net.URI;

/**
 * The managed {@code the-storm-rwf-killstreaks-enabled} flag: killstreak rewards, per player. The
 * identifiers are checked against the shared flag inventory at build time.
 */
public final class FliptRwfKillstreaksGate {

  private static final String NAMESPACE_KEY = "the-storm";
  private static final String FLAG_KEY = "the-storm-rwf-killstreaks-enabled";

  private FliptRwfKillstreaksGate() {}

  /** The flag at {@code base} in {@code environment}, evaluated in {@code world}. */
  public static FliptPlayerFlag create(URI base, String environment, String world) {
    return new FliptPlayerFlag(
        base, environment, world, new FliptPlayerFlag.Key(NAMESPACE_KEY, FLAG_KEY));
  }
}
